import { Effect } from "effect"
import { mergeDeep } from "remeda"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { ConfigParse } from "./parse"
import { ConfigFileLoader } from "./file-loader"
import { Info as ConfigInfo, type Info } from "./info"
import { globalConfigFile, patchJsonc, writable } from "./utils"

export class ConfigWriter {
  constructor(
    private readonly fs: AppFileSystem.Interface,
    private readonly fileLoader: ConfigFileLoader,
  ) {}

  updateInstanceFile = Effect.fnUntraced(function* (this: ConfigWriter, file: string, config: Info) {
    const existing = yield* this.fileLoader.loadFile(file)
    yield* this.fs
      .writeFileString(file, JSON.stringify(mergeDeep(writable(existing), writable(config)), null, 2))
      .pipe(Effect.orDie)
  })

  updateGlobal = Effect.fnUntraced(function* (this: ConfigWriter, config: Info) {
    const file = globalConfigFile()
    const before = (yield* this.fileLoader.readConfigFile(file)) ?? "{}"

    if (!file.endsWith(".jsonc")) {
      const existing = ConfigParse.schema(ConfigInfo, ConfigParse.jsonc(before, file), file)
      const merged = mergeDeep(writable(existing), writable(config))
      yield* this.fs.writeFileString(file, JSON.stringify(merged, null, 2)).pipe(Effect.orDie)
      return merged
    }

    const updated = patchJsonc(before, writable(config))
    const next = ConfigParse.schema(ConfigInfo, ConfigParse.jsonc(updated, file), file)
    yield* this.fs.writeFileString(file, updated).pipe(Effect.orDie)
    return next
  })
}
