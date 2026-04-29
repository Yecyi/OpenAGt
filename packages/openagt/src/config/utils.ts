import path from "path"
import { existsSync } from "fs"
import { mergeDeep } from "remeda"
import { applyEdits, modify } from "jsonc-parser"
import { Log } from "../util"
import { Global } from "../global"
import { isRecord } from "@/util/record"
import { ConfigPlugin } from "./plugin"
import type { Info } from "./config"

const log = Log.create({ service: "config.utils" })

// Custom merge function that concatenates array fields instead of replacing them
export function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeDeep(target, source)
  merged.instructions = Array.from(new Set([...(target.instructions ?? []), ...(source.instructions ?? [])]))
  return merged
}

export function normalizeLoadedConfig(data: unknown, source: string) {
  if (!isRecord(data)) return data
  const copy = { ...data }
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  log.warn("tui keys in openagt config are deprecated; move them to tui.json", { path: source })
  return copy
}

export async function resolveLoadedPlugins<T extends { plugin?: ConfigPlugin.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

export function globalConfigFile() {
  const candidates = ["opencode.jsonc", "opencode.json", "config.json"].map((file) =>
    path.join(Global.Path.config, file),
  )
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

export function patchJsonc(input: string, patchValue: unknown, pathParts: string[] = []): string {
  if (!isRecord(patchValue)) {
    const edits = modify(input, pathParts, patchValue, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patchValue).reduce((result, [key, value]) => {
    if (value === undefined) return result
    return patchJsonc(result, value, [...pathParts, key])
  }, input)
}

export function writable(info: Info) {
  const { plugin_origins: _plugin_origins, ...next } = info
  return next
}
