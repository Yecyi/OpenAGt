import { Effect } from "effect"
import { AppFileSystem } from "@openagt/shared/filesystem"
import type { Log } from "@/util"
import { ConfigParse } from "./parse"
import { ConfigVariable } from "./variable"
import { Info as ConfigInfo, type Info } from "./info"
import { normalizeLoadedConfig, resolveLoadedPlugins } from "./utils"

export const CONFIG_SCHEMA_URL = "https://github.com/Yecyi/OpenAGt/raw/dev/packages/openagt/schema/config.json"

export class ConfigFileLoader {
  constructor(
    private readonly fs: AppFileSystem.Interface,
    private readonly log: Log.Logger,
  ) {}

  readConfigFile = Effect.fnUntraced(function* (this: ConfigFileLoader, filepath: string) {
    return yield* this.fs.readFileString(filepath).pipe(
      Effect.catchIf(
        (e) => e.reason._tag === "NotFound",
        () => Effect.succeed(undefined),
      ),
      Effect.orDie,
    )
  })

  loadConfig = Effect.fnUntraced(function* (
    this: ConfigFileLoader,
    text: string,
    options: { path: string } | { dir: string; source: string },
  ) {
    const source = "path" in options ? options.path : options.source
    const expanded = yield* Effect.promise(() =>
      ConfigVariable.substitute(
        "path" in options ? { text, type: "path", path: options.path } : { text, type: "virtual", ...options },
      ),
    )
    const parsed = ConfigParse.jsonc(expanded, source)
    const data = ConfigParse.schema(ConfigInfo, normalizeLoadedConfig(parsed, source), source)
    if (!("path" in options)) return data

    yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
    if (!data.$schema) {
      data.$schema = CONFIG_SCHEMA_URL
      const updated = text.replace(/^\s*\{/, `{\n  "$schema": "${CONFIG_SCHEMA_URL}",`)
      yield* this.fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void))
    }
    return data
  })

  loadFile = Effect.fnUntraced(function* (this: ConfigFileLoader, filepath: string) {
    this.log.info("loading", { path: filepath })
    const text = yield* this.readConfigFile(filepath)
    if (!text) return {} as Info
    return yield* this.loadConfig(text, { path: filepath })
  })
}
