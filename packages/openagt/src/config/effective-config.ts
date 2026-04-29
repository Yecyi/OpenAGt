import z from "zod"
import { Info as ConfigInfo, type Info } from "./info"

export const EffectiveConfigField = z.enum([
  "permission",
  "exec_policy",
  "experimental.sandbox",
  "model",
  "small_model",
  "agent",
  "provider",
  "mcp",
  "compaction",
  "tools",
])
export type EffectiveConfigField = z.infer<typeof EffectiveConfigField>

export const ConfigSourceScope = z.enum(["global", "local", "managed", "env", "flag", "derived", "unknown"])
export type ConfigSourceScope = z.infer<typeof ConfigSourceScope>

export const ConfigSource = z.object({
  id: z.string(),
  scope: ConfigSourceScope,
  order: z.number(),
})
export type ConfigSource = z.infer<typeof ConfigSource>

export const EffectiveConfigSnapshot = z.object({
  config: ConfigInfo,
  sources: z.array(ConfigSource),
  field_sources: z.partialRecord(EffectiveConfigField, ConfigSource),
})
export type EffectiveConfigSnapshot = z.infer<typeof EffectiveConfigSnapshot>

const globalPatchFields = new Set(["permission", "exec_policy", "experimental", "compaction", "tools", "mcp"])

export const AdvancedGlobalConfigPatch = ConfigInfo.superRefine((config, ctx) => {
  for (const key of Object.keys(config)) {
    if (!globalPatchFields.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "Field cannot be updated through the advanced global config endpoint",
      })
    }
  }

  for (const key of Object.keys(config.experimental ?? {})) {
    if (key !== "sandbox") {
      ctx.addIssue({
        code: "custom",
        path: ["experimental", key],
        message: "Only experimental.sandbox can be updated through the advanced global config endpoint",
      })
    }
  }
})
export type AdvancedGlobalConfigPatch = z.output<typeof AdvancedGlobalConfigPatch>

const fields = EffectiveConfigField.options

const hasField = (config: Info, field: EffectiveConfigField) => {
  if (field === "experimental.sandbox") return config.experimental?.sandbox !== undefined
  return config[field] !== undefined
}

export class EffectiveConfigTracker {
  private nextOrder = 0
  private readonly sources = new Map<string, ConfigSource>()
  private readonly fieldSources = new Map<EffectiveConfigField, ConfigSource>()

  recordConfig(source: string, scope: ConfigSourceScope, config: Info) {
    const item = this.source(source, scope)
    for (const field of fields) {
      if (hasField(config, field)) this.fieldSources.set(field, item)
    }
  }

  recordField(field: EffectiveConfigField, source: string, scope: ConfigSourceScope) {
    this.fieldSources.set(field, this.source(source, scope))
  }

  recordFieldIfMissing(field: EffectiveConfigField, source: string, scope: ConfigSourceScope) {
    if (this.fieldSources.has(field)) return
    this.recordField(field, source, scope)
  }

  recordConfigOnly(source: string, scope: ConfigSourceScope, config: Info) {
    this.recordConfig(source, scope, config)
  }

  snapshot(config: Info): EffectiveConfigSnapshot {
    return {
      config,
      sources: Array.from(this.sources.values()).sort((a, b) => a.order - b.order),
      field_sources: Object.fromEntries(this.fieldSources) as Partial<Record<EffectiveConfigField, ConfigSource>>,
    }
  }

  private source(id: string, scope: ConfigSourceScope) {
    const existing = this.sources.get(id)
    if (existing) return existing

    const next = { id, scope, order: this.nextOrder++ }
    this.sources.set(id, next)
    return next
  }
}
