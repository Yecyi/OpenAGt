import { Effect } from "effect"
import { mergeDeep } from "remeda"
import { ConfigPermission } from "./permission"
import { ConfigPlugin } from "./plugin"
import { ConfigPluginOriginMerger } from "./plugin-origin-merger"
import { EffectiveConfigTracker, type ConfigSourceScope, type EffectiveConfigSnapshot } from "./effective-config"
import type { Info } from "./info"

export class ConfigInstanceMergePipeline {
  private readonly pluginOrigins: ConfigPluginOriginMerger
  private readonly effective = new EffectiveConfigTracker()

  constructor(public result: Info = {}) {
    this.pluginOrigins = new ConfigPluginOriginMerger(result)
  }

  mergePluginOrigins = Effect.fnUntraced(function* (
    this: ConfigInstanceMergePipeline,
    source: string,
    list: ConfigPlugin.Spec[] | undefined,
    kind?: ConfigPlugin.Scope,
  ) {
    this.pluginOrigins.result = this.result
    yield* this.pluginOrigins.mergePluginOrigins(source, list, kind)
    this.result = this.pluginOrigins.result
  })

  merge = Effect.fnUntraced(function* (
    this: ConfigInstanceMergePipeline,
    source: string,
    next: Info,
    kind?: ConfigPlugin.Scope,
  ) {
    this.effective.recordConfig(source, kind ?? "unknown", next)
    this.pluginOrigins.result = this.result
    yield* this.pluginOrigins.merge(source, next, kind)
    this.result = this.pluginOrigins.result
  })

  applyToolsPermissionCompatibility() {
    if (!this.result.tools) return

    const perms: Record<string, ConfigPermission.Action> = {}
    for (const [tool, enabled] of Object.entries(this.result.tools)) {
      const action: ConfigPermission.Action = enabled ? "allow" : "deny"
      if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
        perms.edit = action
        continue
      }
      perms[tool] = action
    }
    this.result.permission = mergeDeep(perms, this.result.permission ?? {})
    this.effective.recordField("permission", "tools", "derived")
  }

  recordField(field: Parameters<EffectiveConfigTracker["recordField"]>[0], source: string, scope: ConfigSourceScope) {
    this.effective.recordField(field, source, scope)
  }

  snapshot(): EffectiveConfigSnapshot {
    return this.effective.snapshot(this.result)
  }
}
