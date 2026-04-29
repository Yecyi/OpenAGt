import fsNode from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import { mergeDeep, pipe } from "remeda"
import { Global } from "../global"
import { CONFIG_SCHEMA_URL, ConfigFileLoader } from "./file-loader"
import type { Info } from "./info"

export class ConfigGlobalLoader {
  constructor(private readonly fileLoader: ConfigFileLoader) {}

  loadGlobal = Effect.fnUntraced(function* (this: ConfigGlobalLoader) {
    let result: Info = pipe(
      {},
      mergeDeep(yield* this.fileLoader.loadFile(path.join(Global.Path.config, "config.json"))),
      mergeDeep(yield* this.fileLoader.loadFile(path.join(Global.Path.config, "opencode.json"))),
      mergeDeep(yield* this.fileLoader.loadFile(path.join(Global.Path.config, "opencode.jsonc"))),
    )

    const legacy = path.join(Global.Path.config, "config")
    if (existsSync(legacy)) {
      yield* Effect.promise(() =>
        import(pathToFileURL(legacy).href, { with: { type: "toml" } })
          .then(async (mod) => {
            const { provider, model, ...rest } = mod.default
            if (provider && model) result.model = `${provider}/${model}`
            result["$schema"] = CONFIG_SCHEMA_URL
            result = mergeDeep(result, rest)
            await fsNode.writeFile(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
            await fsNode.unlink(legacy)
          })
          .catch(() => {}),
      )
    }

    return result
  })
}
