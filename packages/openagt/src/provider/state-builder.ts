// Builds provider runtime state from config, auth, env, plugins, and model catalogs.
// It does not resolve SDK language models or implement Provider service methods.
import { Effect } from "effect"
import { mapValues, mergeDeep } from "remeda"
import { Auth } from "../auth"
import { Config } from "../config"
import { Env } from "../env"
import { EffectBridge } from "../effect"
import { Flag } from "../flag/flag"
import { Plugin } from "../plugin"
import { Log } from "../util"
import { ModelID, ProviderID } from "./schema"
import * as ModelsDev from "./models"
import { applyModelCatalogPolicy } from "./model-catalog-policy"
import { fromModelsDevProvider } from "./models-dev-conversion"
import { extendCatalogWithConfigProviders } from "./config-provider-catalog"
import type { BundledSDK } from "./bundled-provider-registry"
import { bedrockCustomLoader } from "./custom-loaders-bedrock"
import { cloudflareCustomLoaders } from "./custom-loaders-cloudflare"
import { cloudCustomLoaders } from "./custom-loaders-cloud"
import { coreCustomLoaders } from "./custom-loaders-core"
import { gitlabCustomLoader } from "./custom-loaders-gitlab"
import { integrationHeaderLoaders } from "./custom-loaders-integrations"
import { routingCustomLoaders, zenmuxCustomLoader } from "./custom-loaders-routing"
import type {
  CustomDep,
  CustomDiscoverModels,
  CustomLoader,
  CustomModelLoader,
  CustomVarsLoader,
} from "./custom-loader-types"
import type { Info } from "./provider"
import type { LanguageModelV3 } from "@ai-sdk/provider"

const log = Log.create({ service: "provider" })

export interface ProviderState {
  models: Map<string, LanguageModelV3>
  providers: Record<ProviderID, Info>
  sdk: Map<string, BundledSDK>
  modelLoaders: Record<string, CustomModelLoader>
  varsLoaders: Record<string, CustomVarsLoader>
}

function custom(dep: CustomDep): Record<string, CustomLoader> {
  return {
    ...coreCustomLoaders(dep),
    ...bedrockCustomLoader(dep),
    ...routingCustomLoaders(),
    ...cloudCustomLoaders(dep),
    ...zenmuxCustomLoader(),
    ...gitlabCustomLoader(dep),
    ...cloudflareCustomLoaders(dep),
    ...integrationHeaderLoaders(),
  }
}

export class ProviderStateBuilder {
  constructor(
    private readonly deps: {
      auth: Auth.Interface
      config: Config.Interface
      env: Env.Interface
      plugin: Plugin.Interface
    },
  ) {}

  build(): Effect.Effect<ProviderState> {
    const deps = this.deps
    return Effect.gen(function* () {
      using _ = log.time("state")
      const bridge = yield* EffectBridge.make()
      const cfg = yield* deps.config.get()
      const modelsDev = yield* Effect.promise(() => ModelsDev.get())
      const database = mapValues(modelsDev, fromModelsDevProvider)

      const providers: Record<ProviderID, Info> = {} as Record<ProviderID, Info>
      const languages = new Map<string, LanguageModelV3>()
      const modelLoaders: {
        [providerID: string]: CustomModelLoader
      } = {}
      const varsLoaders: {
        [providerID: string]: CustomVarsLoader
      } = {}
      const sdk = new Map<string, BundledSDK>()
      const discoveryLoaders: {
        [providerID: string]: CustomDiscoverModels
      } = {}
      const dep = {
        auth: (id: string) => deps.auth.get(id).pipe(Effect.orDie),
        config: () => deps.config.get(),
        env: () => deps.env.all(),
        get: (key: string) => deps.env.get(key),
      }

      log.info("init")

      function mergeProvider(providerID: ProviderID, provider: Partial<Info>) {
        const existing = providers[providerID]
        if (existing) {
          // @ts-expect-error
          providers[providerID] = mergeDeep(existing, provider)
          return
        }
        const match = database[providerID]
        if (!match) return
        // @ts-expect-error
        providers[providerID] = mergeDeep(match, provider)
      }

      // load plugins first so config() hook runs before reading cfg.provider
      const plugins = yield* deps.plugin.list()

      // now read config providers - includes any modifications from plugin config() hook
      const configProviders = Object.entries(cfg.provider ?? {})
      const disabled = new Set(cfg.disabled_providers ?? [])
      const enabled = cfg.enabled_providers ? new Set(cfg.enabled_providers) : null

      function isProviderAllowed(providerID: ProviderID): boolean {
        if (enabled && !enabled.has(providerID)) return false
        if (disabled.has(providerID)) return false
        return true
      }

      extendCatalogWithConfigProviders({ database, modelsDev, configProviders })

      // load env
      const envs = yield* deps.env.all()
      for (const [id, provider] of Object.entries(database)) {
        const providerID = ProviderID.make(id)
        if (disabled.has(providerID)) continue
        const apiKey = provider.env.map((item) => envs[item]).find(Boolean)
        if (!apiKey) continue
        mergeProvider(providerID, {
          source: "env",
          key: provider.env.length === 1 ? apiKey : undefined,
        })
      }

      // load apikeys
      const auths = yield* deps.auth.all().pipe(Effect.orDie)
      for (const [id, provider] of Object.entries(auths)) {
        const providerID = ProviderID.make(id)
        if (disabled.has(providerID)) continue
        if (provider.type === "api") {
          mergeProvider(providerID, {
            source: "api",
            key: provider.key,
          })
        }
      }

      // plugin auth loader - database now has entries for config providers
      for (const plugin of plugins) {
        if (!plugin.auth) continue
        const providerID = ProviderID.make(plugin.auth.provider)
        if (disabled.has(providerID)) continue

        const stored = yield* deps.auth.get(providerID).pipe(Effect.orDie)
        if (!stored) continue
        if (!plugin.auth.loader) continue

        const options = yield* Effect.promise(() =>
          plugin.auth!.loader!(
            () => bridge.promise(deps.auth.get(providerID).pipe(Effect.orDie)) as any,
            database[plugin.auth!.provider],
          ),
        )
        const opts = options ?? {}
        const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
        mergeProvider(providerID, patch)
      }

      for (const [id, fn] of Object.entries(custom(dep))) {
        const providerID = ProviderID.make(id)
        if (disabled.has(providerID)) continue
        const data = database[providerID]
        if (!data) {
          log.error("Provider does not exist in model list " + providerID)
          continue
        }
        const result = yield* fn(data)
        if (result && (result.autoload || providers[providerID])) {
          if (result.getModel) modelLoaders[providerID] = result.getModel
          if (result.vars) varsLoaders[providerID] = result.vars
          if (result.discoverModels) discoveryLoaders[providerID] = result.discoverModels
          const opts = result.options ?? {}
          const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
          mergeProvider(providerID, patch)
        }
      }

      // load config - re-apply with updated data
      for (const [id, provider] of configProviders) {
        const providerID = ProviderID.make(id)
        const partial: Partial<Info> = { source: "config" }
        if (provider.env) partial.env = provider.env
        if (provider.name) partial.name = provider.name
        if (provider.options) partial.options = provider.options
        mergeProvider(providerID, partial)
      }

      const gitlab = ProviderID.make("gitlab")
      if (discoveryLoaders[gitlab] && providers[gitlab] && isProviderAllowed(gitlab)) {
        yield* Effect.promise(async () => {
          try {
            const discovered = await discoveryLoaders[gitlab]()
            for (const [modelID, model] of Object.entries(discovered)) {
              if (!providers[gitlab].models[modelID]) {
                providers[gitlab].models[modelID] = model
              }
            }
          } catch (e) {
            log.warn("state discovery error", { id: "gitlab", error: e })
          }
        })
      }

      for (const hook of plugins) {
        const p = hook.provider
        const models = p?.models
        if (!p || !models) continue

        const providerID = ProviderID.make(p.id)
        if (disabled.has(providerID)) continue

        const provider = providers[providerID]
        if (!provider) continue
        const pluginAuth = yield* deps.auth.get(providerID).pipe(Effect.orDie)

        provider.models = yield* Effect.promise(async () => {
          const next = await models(provider, { auth: pluginAuth })
          return Object.fromEntries(
            Object.entries(next).map(([id, model]) => [
              id,
              {
                ...model,
                id: ModelID.make(id),
                providerID,
              },
            ]),
          )
        })
      }

      for (const [id, provider] of Object.entries(providers)) {
        const providerID = ProviderID.make(id)
        if (!isProviderAllowed(providerID)) {
          delete providers[providerID]
          continue
        }

        const configProvider = cfg.provider?.[providerID]

        applyModelCatalogPolicy({
          providerID,
          provider,
          configProvider,
          experimentalModels: Flag.OPENCODE_ENABLE_EXPERIMENTAL_MODELS,
        })

        if (Object.keys(provider.models).length === 0) {
          delete providers[providerID]
          continue
        }

        log.info("found", { providerID })
      }

      return {
        models: languages,
        providers,
        sdk,
        modelLoaders,
        varsLoaders,
      }
    })
  }
}
