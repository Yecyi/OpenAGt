import z from "zod"
import fuzzysort from "fuzzysort"
import { Config } from "../config"
import { NoSuchModelError } from "ai"
import { Log } from "../util"
import { Plugin } from "../plugin"
import { NamedError } from "@openagt/shared/util/error"
import { type LanguageModelV3 } from "@ai-sdk/provider"
import { Auth } from "../auth"
import { Env } from "../env"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import path from "path"
import { Effect, Layer, Context, Schema, Types } from "effect"
import { InstanceState } from "@/effect"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { isRecord } from "@/util/record"
import { withStatics } from "@/util/schema"

import { ModelID, ProviderID } from "./schema"
import { defaultModelIDs, parseModel, sort } from "./model-selection"
import { BundledProviderRegistry } from "./bundled-provider-registry"
import { resolveProviderSDK } from "./sdk-runtime"
import { ProviderStateBuilder, type ProviderState } from "./state-builder"
import * as ProviderAuth from "./auth"
import { providerModelCacheKey } from "./cache-scope"

export { defaultModelIDs, parseModel, sort } from "./model-selection"
export { fromModelsDevProvider } from "./models-dev-conversion"

const log = Log.create({ service: "provider" })

const ProviderApiInfo = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  npm: Schema.String,
})

const ProviderModalities = Schema.Struct({
  text: Schema.Boolean,
  audio: Schema.Boolean,
  image: Schema.Boolean,
  video: Schema.Boolean,
  pdf: Schema.Boolean,
})

const ProviderInterleaved = Schema.Union([
  Schema.Boolean,
  Schema.Struct({
    field: Schema.Literals(["reasoning_content", "reasoning_details"]),
  }),
])

const ProviderCapabilities = Schema.Struct({
  temperature: Schema.Boolean,
  reasoning: Schema.Boolean,
  attachment: Schema.Boolean,
  toolcall: Schema.Boolean,
  input: ProviderModalities,
  output: ProviderModalities,
  interleaved: ProviderInterleaved,
})

const ProviderCacheCost = Schema.Struct({
  read: Schema.Number,
  write: Schema.Number,
})

const ProviderCost = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cache: ProviderCacheCost,
  experimentalOver200K: Schema.optional(
    Schema.Struct({
      input: Schema.Number,
      output: Schema.Number,
      cache: ProviderCacheCost,
    }),
  ),
})

const ProviderLimit = Schema.Struct({
  context: Schema.Number,
  input: Schema.optional(Schema.Number),
  output: Schema.Number,
})

export const Model = Schema.Struct({
  id: ModelID,
  providerID: ProviderID,
  api: ProviderApiInfo,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  capabilities: ProviderCapabilities,
  cost: ProviderCost,
  limit: ProviderLimit,
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  options: Schema.Record(Schema.String, Schema.Any),
  headers: Schema.Record(Schema.String, Schema.String),
  release_date: Schema.String,
  variants: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Any))),
})
  .annotate({ identifier: "Model" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Model = Types.DeepMutable<Schema.Schema.Type<typeof Model>>

export const Info = Schema.Struct({
  id: ProviderID,
  name: Schema.String,
  source: Schema.Literals(["env", "config", "custom", "api"]),
  env: Schema.Array(Schema.String),
  key: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Any),
  models: Schema.Record(Schema.String, Model),
})
  .annotate({ identifier: "Provider" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

const DefaultModelIDs = Schema.Record(Schema.String, Schema.String)

export const ListResult = Schema.Struct({
  all: Schema.Array(Info),
  default: DefaultModelIDs,
  connected: Schema.Array(Schema.String),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type ListResult = Types.DeepMutable<Schema.Schema.Type<typeof ListResult>>

export const ConfigProvidersResult = Schema.Struct({
  providers: Schema.Array(Info),
  default: DefaultModelIDs,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type ConfigProvidersResult = Types.DeepMutable<Schema.Schema.Type<typeof ConfigProvidersResult>>

export interface Interface {
  readonly list: () => Effect.Effect<Record<ProviderID, Info>>
  readonly getProvider: (providerID: ProviderID) => Effect.Effect<Info>
  readonly getModel: (providerID: ProviderID, modelID: ModelID) => Effect.Effect<Model>
  readonly getLanguage: (model: Model) => Effect.Effect<LanguageModelV3>
  readonly closest: (
    providerID: ProviderID,
    query: string[],
  ) => Effect.Effect<{ providerID: ProviderID; modelID: string } | undefined>
  readonly getSmallModel: (providerID: ProviderID) => Effect.Effect<Model | undefined>
  readonly defaultModel: () => Effect.Effect<{ providerID: ProviderID; modelID: ModelID }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Provider") {}

const layer: Layer.Layer<
  Service,
  never,
  Config.Service | Auth.Service | Plugin.Service | AppFileSystem.Service | Env.Service | ProviderAuth.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const env = yield* Env.Service
    const plugin = yield* Plugin.Service
    const providerAuth = yield* ProviderAuth.Service
    const bundledProviders = new BundledProviderRegistry()

    const state = yield* InstanceState.make<ProviderState>(() =>
      new ProviderStateBuilder({ auth, config, env, plugin }).build(),
    )

    const list = Effect.fn("Provider.list")(() => InstanceState.use(state, (s) => s.providers))

    const getProvider = Effect.fn("Provider.getProvider")((providerID: ProviderID) =>
      InstanceState.use(state, (s) => s.providers[providerID]),
    )

    const getModel = Effect.fn("Provider.getModel")(function* (providerID: ProviderID, modelID: ModelID) {
      const s = yield* InstanceState.get(state)
      const provider = s.providers[providerID]
      if (!provider) {
        const available = Object.keys(s.providers)
        const matches = fuzzysort.go(providerID, available, { limit: 3, threshold: -10000 })
        throw new ModelNotFoundError({ providerID, modelID, suggestions: matches.map((m) => m.target) })
      }

      const info = provider.models[modelID]
      if (!info) {
        const available = Object.keys(provider.models)
        const matches = fuzzysort.go(modelID, available, { limit: 3, threshold: -10000 })
        throw new ModelNotFoundError({ providerID, modelID, suggestions: matches.map((m) => m.target) })
      }
      return info
    })

    const getLanguage = Effect.fn("Provider.getLanguage")(function* (model: Model) {
      const s = yield* InstanceState.get(state)
      const envs = yield* env.all()
      const provider = s.providers[model.providerID]
      const loadAuth = () => auth.get(model.providerID).pipe(Effect.orElseSucceed(() => undefined))
      const refreshExpiredOAuth = Effect.fn("Provider.refreshExpiredOAuth")(function* (
        current: Extract<Auth.Info, { type: "oauth" }>,
      ) {
        if (current?.type !== "oauth") return false
        if (current.expires > Date.now()) return false
        return yield* providerAuth.refresh(model.providerID).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              log.warn("failed to refresh expired oauth token before rebuilding language model", {
                providerID: model.providerID,
                modelID: model.id,
                error,
              })
              return false
            }),
          ),
        )
      })

      const initialAuth = yield* loadAuth()
      const storedAuth =
        initialAuth?.type === "oauth" && initialAuth.expires <= Date.now() && (yield* refreshExpiredOAuth(initialAuth))
          ? yield* loadAuth()
          : initialAuth

      if (provider && storedAuth?.type === "api") provider.key = storedAuth.key
      if (provider && storedAuth?.type === "oauth") provider.key = storedAuth.access
      if (provider && storedAuth?.type === "wellknown") provider.key = storedAuth.key
      if (provider && !storedAuth && provider.source !== "env" && provider.options.apiKey === undefined) delete provider.key

      // Cache key includes provider/model options and the active auth account
      // scope. This prevents account switches from reusing a stale
      // LanguageModelV3 or SDK client that was built with a previous token.
      const mergedOptions = { ...provider?.options, ...model.options }
      const key = providerModelCacheKey({
        providerID: model.providerID,
        modelID: model.id,
        options: mergedOptions,
        auth: storedAuth,
      })

      if (s.models.has(key)) {
        const expiresAtMs = s.modelExpiry.get(key)
        if (expiresAtMs === undefined || expiresAtMs > Date.now()) return s.models.get(key)!
        log.warn("invalidating cached language model for expired oauth token", {
          providerID: model.providerID,
          modelID: model.id,
          expiredAtMs: expiresAtMs,
          refreshed: storedAuth?.type === "oauth" ? yield* refreshExpiredOAuth(storedAuth) : false,
        })
        s.models.delete(key)
        s.modelExpiry.delete(key)
      }

      const language = yield* Effect.promise(async () => {
        const sdk = await resolveProviderSDK({
          model,
          state: s,
          envs,
          bundledProviders,
          log,
          initError: (providerID, cause) => new InitError({ providerID }, { cause }),
        })

        try {
          const built = s.modelLoaders[model.providerID]
            ? await s.modelLoaders[model.providerID](sdk, model.api.id, mergedOptions)
            : sdk.languageModel(model.api.id)
          s.models.set(key, built)
          return built
        } catch (e) {
          if (e instanceof NoSuchModelError)
            throw new ModelNotFoundError(
              {
                modelID: model.id,
                providerID: model.providerID,
              },
              { cause: e },
            )
          throw e
        }
      })
      // Record expiry alongside the new cache entry so subsequent calls can
      // detect stale OAuth tokens without re-reading auth.json. Done once
      // per cache miss, not once per call. Non-OAuth providers leave the
      // expiry slot empty and the cache entry never auto-invalidates.
      if (storedAuth?.type === "oauth") s.modelExpiry.set(key, storedAuth.expires)
      return language
    })

    const closest = Effect.fn("Provider.closest")(function* (providerID: ProviderID, query: string[]) {
      const s = yield* InstanceState.get(state)
      const provider = s.providers[providerID]
      if (!provider) return undefined
      for (const item of query) {
        for (const modelID of Object.keys(provider.models)) {
          if (modelID.includes(item)) return { providerID, modelID }
        }
      }
      return undefined
    })

    const getSmallModel = Effect.fn("Provider.getSmallModel")(function* (providerID: ProviderID) {
      const cfg = yield* config.get()

      if (cfg.small_model) {
        const parsed = parseModel(cfg.small_model)
        return yield* getModel(parsed.providerID, parsed.modelID)
      }

      const s = yield* InstanceState.get(state)
      const provider = s.providers[providerID]
      if (!provider) return undefined

      let priority = [
        "claude-haiku-4-5",
        "claude-haiku-4.5",
        "3-5-haiku",
        "3.5-haiku",
        "gemini-3-flash",
        "gemini-2.5-flash",
        "gpt-5-nano",
      ]
      if (providerID.startsWith("opencode")) {
        priority = ["gpt-5-nano"]
      }
      if (providerID.startsWith("github-copilot")) {
        priority = ["gpt-5-mini", "claude-haiku-4.5", ...priority]
      }
      for (const item of priority) {
        if (providerID === ProviderID.amazonBedrock) {
          const crossRegionPrefixes = ["global.", "us.", "eu."]
          const candidates = Object.keys(provider.models).filter((m) => m.includes(item))

          const globalMatch = candidates.find((m) => m.startsWith("global."))
          if (globalMatch) return yield* getModel(providerID, ModelID.make(globalMatch))

          const region = provider.options?.region
          if (region) {
            const regionPrefix = region.split("-")[0]
            if (regionPrefix === "us" || regionPrefix === "eu") {
              const regionalMatch = candidates.find((m) => m.startsWith(`${regionPrefix}.`))
              if (regionalMatch) return yield* getModel(providerID, ModelID.make(regionalMatch))
            }
          }

          const unprefixed = candidates.find((m) => !crossRegionPrefixes.some((p) => m.startsWith(p)))
          if (unprefixed) return yield* getModel(providerID, ModelID.make(unprefixed))
        } else {
          for (const model of Object.keys(provider.models)) {
            if (model.includes(item)) return yield* getModel(providerID, ModelID.make(model))
          }
        }
      }

      return undefined
    })

    const defaultModel = Effect.fn("Provider.defaultModel")(function* () {
      const cfg = yield* config.get()
      if (cfg.model) return parseModel(cfg.model)

      const s = yield* InstanceState.get(state)
      const recent = yield* fs.readJson(path.join(Global.Path.state, "model.json")).pipe(
        Effect.map((x): { providerID: ProviderID; modelID: ModelID }[] => {
          if (!isRecord(x) || !Array.isArray(x.recent)) return []
          return x.recent.flatMap((item) => {
            if (!isRecord(item)) return []
            if (typeof item.providerID !== "string") return []
            if (typeof item.modelID !== "string") return []
            return [{ providerID: ProviderID.make(item.providerID), modelID: ModelID.make(item.modelID) }]
          })
        }),
        Effect.catch(() => Effect.succeed([] as { providerID: ProviderID; modelID: ModelID }[])),
      )
      for (const entry of recent) {
        const provider = s.providers[entry.providerID]
        if (!provider) continue
        if (!provider.models[entry.modelID]) continue
        return { providerID: entry.providerID, modelID: entry.modelID }
      }

      const provider = Object.values(s.providers).find((p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id))
      if (!provider) throw new Error("no providers found")
      const [model] = sort(Object.values(provider.models))
      if (!model) throw new Error("no models found")
      return {
        providerID: provider.id,
        modelID: model.id,
      }
    })

    return Service.of({ list, getProvider, getModel, getLanguage, closest, getSmallModel, defaultModel })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Env.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(ProviderAuth.defaultLayer),
  ),
)

export const ModelNotFoundError = NamedError.create(
  "ProviderModelNotFoundError",
  z.object({
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
    suggestions: z.array(z.string()).optional(),
  }),
)

export const InitError = NamedError.create(
  "ProviderInitError",
  z.object({
    providerID: ProviderID.zod,
  }),
)
