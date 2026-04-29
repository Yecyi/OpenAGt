// Tracks config plugin provenance while merging layered config sources.
// It does not load files, install plugins, or decide config source precedence.
import { Effect } from "effect"
import { Instance } from "../project/instance"
import { InstanceRef } from "../effect/instance-ref"
import { ConfigPlugin } from "./plugin"
import { mergeConfigConcatArrays } from "./utils"
import type { Info } from "./config"

export class ConfigPluginOriginMerger {
  constructor(public result: Info) {}

  private scopeForSource(source: string): Effect.Effect<ConfigPlugin.Scope> {
    return Effect.gen(function* () {
      if (source.startsWith("http://") || source.startsWith("https://")) return "global"
      if (source === "OPENCODE_CONFIG_CONTENT") return "local"
      if (yield* InstanceRef.use((ctx) => Effect.succeed(Instance.containsPath(source, ctx)))) return "local"
      return "global"
    })
  }

  mergePluginOrigins(
    source: string,
    // Receives raw Specs from one config source, before provenance for this merge step is attached.
    list: ConfigPlugin.Spec[] | undefined,
    // Scope can be inferred from source path, but callers that already know can pass it explicitly.
    kind?: ConfigPlugin.Scope,
  ): Effect.Effect<void> {
    const getResult = () => this.result
    const setResult = (next: Info) => {
      this.result = next
    }
    const scopeForSource = (input: string) => this.scopeForSource(input)
    return Effect.gen(function* () {
      if (!list?.length) return
      const hit = kind ?? (yield* scopeForSource(source))
      const current = getResult()
      const plugins = ConfigPlugin.deduplicatePluginOrigins([
        ...(current.plugin_origins ?? []),
        ...list.map((spec) => ({ spec, source, scope: hit })),
      ])
      current.plugin = plugins.map((item) => item.spec)
      current.plugin_origins = plugins
      setResult(current)
    })
  }

  merge(source: string, next: Info, kind?: ConfigPlugin.Scope): Effect.Effect<void> {
    const getResult = () => this.result
    const setResult = (value: Info) => {
      this.result = value
    }
    const mergePluginOrigins = (inputSource: string, list?: ConfigPlugin.Spec[], inputKind?: ConfigPlugin.Scope) =>
      this.mergePluginOrigins(inputSource, list, inputKind)
    return Effect.gen(function* () {
      setResult(mergeConfigConcatArrays(getResult(), next))
      yield* mergePluginOrigins(source, next.plugin, kind)
    })
  }
}
