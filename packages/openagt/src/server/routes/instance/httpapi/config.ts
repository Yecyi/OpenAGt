import { Config } from "@/config"
import { Provider } from "@/provider"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/config"

const ConfigJsonObject = Schema.Record(Schema.String, Schema.Unknown)
const ConfigSourceHttp = Schema.Struct({
  id: Schema.String,
  scope: Schema.String,
  order: Schema.Number,
})
const EffectiveConfigSnapshotHttp = Schema.Struct({
  config: ConfigJsonObject,
  sources: Schema.Array(ConfigSourceHttp),
  field_sources: Schema.Record(Schema.String, ConfigSourceHttp),
})

export const ConfigApi = HttpApi.make("config")
  .add(
    HttpApiGroup.make("config")
      .add(
        HttpApiEndpoint.get("providers", `${root}/providers`, {
          success: Provider.ConfigProvidersResult,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.providers",
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
          }),
        ),
        HttpApiEndpoint.get("effective", `${root}/effective`, {
          success: EffectiveConfigSnapshotHttp,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.effective",
            summary: "Get effective configuration",
            description: "Retrieve the current merged configuration with source metadata for advanced settings.",
          }),
        ),
        HttpApiEndpoint.patch("updateGlobal", `${root}/global`, {
          payload: ConfigJsonObject,
          success: ConfigJsonObject,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.global.update",
            summary: "Update advanced global configuration",
            description: "Update the safe advanced-settings subset of the global OpenAGt configuration.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config",
          description: "Experimental HttpApi config routes.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const configHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* provider.list()
      return {
        providers: Object.values(providers),
        default: Provider.defaultModelIDs(providers),
      }
    })

    const effective = Effect.fn("ConfigHttpApi.effective")(function* () {
      const snapshot = yield* cfg.effective()
      return {
        config: snapshot.config as Record<string, unknown>,
        sources: snapshot.sources,
        field_sources: snapshot.field_sources as Record<
          string,
          {
            id: string
            scope: string
            order: number
          }
        >,
      }
    })

    const updateGlobal = Effect.fn("ConfigHttpApi.updateGlobal")(function* (ctx: {
      payload: Record<string, unknown>
    }) {
      const parsed = Config.AdvancedGlobalConfigPatch.safeParse(ctx.payload)
      if (!parsed.success) return yield* new HttpApiError.BadRequest({})
      return (yield* cfg.updateGlobal(parsed.data)) as Record<string, unknown>
    })

    return HttpApiBuilder.group(ConfigApi, "config", (handlers) =>
      handlers.handle("providers", providers).handle("effective", effective).handle("updateGlobal", updateGlobal),
    )
  }),
).pipe(Layer.provide(Provider.defaultLayer), Layer.provide(Config.defaultLayer))
