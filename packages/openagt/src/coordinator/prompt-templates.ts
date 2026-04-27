export * as PromptTemplates from "./prompt-templates"

// Prompt template registry — Stream C of the v1.21 plan.
//
// Centralizes the prompts currently hardcoded inside `*Node()` factories
// in coordinator.ts (e.g. reviseNode at L773-820, checkpointNode at L822-859).
// Templates live under `coordinator/prompts/<role>/<variant>.md` and are
// loaded via `import.meta.glob` so they get bundled the same way as drizzle
// migrations.
//
// Variant selection uses a Beta-Bernoulli (Thompson sampling-lite) policy
// driven by the prompt_outcome table populated in C.5. Until C.5 lands the
// picker simply returns the variant tagged `default`.

import { Context, Effect, Layer } from "effect"
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import path from "path"
import { Log } from "../util"
import { Database, eq, gte, and } from "@/storage"
import { Identifier } from "@/id/id"
import { PromptOutcomeTable } from "./prompt-outcome.sql"

const log = Log.create({ service: "prompt-templates" })

// Build-time bundled templates. Populated by the bundler (production build)
// or left undefined (dev mode reads from filesystem). Mirrors the
// OPENCODE_MIGRATIONS pattern in storage/db.ts.
declare const OPENAGT_PROMPT_TEMPLATES: Record<string, string> | undefined

export interface PromptTemplate {
  readonly role: string
  readonly variant: string
  readonly weight: number
  readonly content: string
  readonly metadata: Record<string, unknown>
}

export interface PromptVars {
  readonly [key: string]: string | number | boolean | undefined
}

export interface PickContext {
  readonly role: string
  readonly seed?: string
  readonly forceVariant?: string
}

export interface OutcomeRecord {
  readonly role: string
  readonly variant: string
  readonly success: boolean
  readonly quality?: number
  readonly duration_ms?: number
  readonly task_id?: string
  readonly expert_id?: string
}

export interface Interface {
  readonly forRole: (role: string) => Effect.Effect<readonly PromptTemplate[]>
  readonly pickVariant: (
    ctx: PickContext,
    vars?: PromptVars,
    fallback?: () => string,
  ) => Effect.Effect<{ template: PromptTemplate | undefined; rendered: string }>
  readonly render: (template: PromptTemplate, vars: PromptVars) => string
  readonly recordOutcome: (record: OutcomeRecord) => Effect.Effect<void>
  readonly reload: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/PromptTemplates") {}

// Tiny template engine — `{{var}}` substitution only. Whitespace inside the
// braces is tolerated. Unknown vars render as empty string. Intentionally
// limited (no conditionals, no loops) to keep the attack surface tiny and
// the rendered output predictable.
export function renderTemplate(template: string, vars: PromptVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const value = vars[name]
    return value === undefined || value === null ? "" : String(value)
  })
}

// Parse `---\nfrontmatter yaml\n---\nbody` into structured PromptTemplate.
// Frontmatter is best-effort: a missing or malformed block yields an empty
// metadata record. Errors are logged but not thrown so a single bad file does
// not poison the whole registry.
function parseTemplate(role: string, raw: string): PromptTemplate | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw)
  if (!fm) {
    log.warn("template missing frontmatter — treating whole file as default variant body", { role })
    return {
      role,
      variant: "default",
      weight: 1,
      content: raw.trim().replace(/\r\n/g, "\n"),
      metadata: {},
    }
  }
  const meta: Record<string, unknown> = {}
  for (const line of fm[1]!.split(/\r?\n/)) {
    const m = /^(\w+)\s*:\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    const key = m[1]!
    const raw = m[2]!
    // Coerce numbers and booleans, otherwise treat as string.
    if (raw === "true") meta[key] = true
    else if (raw === "false") meta[key] = false
    else if (/^-?\d+(\.\d+)?$/.test(raw)) meta[key] = Number(raw)
    else meta[key] = raw.replace(/^"(.*)"$/, "$1")
  }
  return {
    role,
    variant: typeof meta.variant === "string" ? (meta.variant as string) : "default",
    weight: typeof meta.weight === "number" ? (meta.weight as number) : 1,
    content: fm[2]!.trim().replace(/\r\n/g, "\n"),
    metadata: meta,
  }
}

// Builds a registry from an in-memory map (path -> raw template string).
// Production callers will populate via import.meta.glob; tests can pass an
// explicit fixture map. Path format: "<role>/<variant>.md".
export function buildRegistry(files: Record<string, string>) {
  const byRole = new Map<string, PromptTemplate[]>()
  for (const [filePath, raw] of Object.entries(files)) {
    const m = /(?:^|\/)([^/]+)\/([^/]+)\.md$/.exec(filePath)
    if (!m) {
      log.warn("template path does not match <role>/<variant>.md — skipping", { filePath })
      continue
    }
    const role = m[1]!
    const parsed = parseTemplate(role, raw)
    if (!parsed) continue
    // Honor variant override from filename if frontmatter omits it.
    const variant = parsed.metadata.variant ? parsed.variant : m[2]!
    const entry: PromptTemplate = { ...parsed, variant }
    const list = byRole.get(role) ?? []
    list.push(entry)
    byRole.set(role, list)
  }
  return byRole
}

// Weighted random pick among variants, biased by `seed` for reproducibility.
// Without an outcome table (C.5) this is just stable weighted random; once
// telemetry is wired in, the picker becomes Thompson sampling-lite.
function weightedPick<T extends { weight: number }>(items: readonly T[], rand: () => number): T | undefined {
  if (items.length === 0) return undefined
  const total = items.reduce((acc, item) => acc + Math.max(0, item.weight), 0)
  if (total <= 0) return items[0]
  const target = rand() * total
  let acc = 0
  for (const item of items) {
    acc += Math.max(0, item.weight)
    if (target <= acc) return item
  }
  return items[items.length - 1]
}

function seededRandom(seed: string): () => number {
  // FNV-1a 32-bit hash → seed for a tiny LCG. Deterministic per seed string.
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  let state = h >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

// =============================================================================
// C.5 — Thompson sampling-lite for variant selection
// =============================================================================

// Beta(s+1, f+1) sampling using two uniforms (rejection-free polar form would
// be heavier than necessary). For our use case (10s–100s of samples per
// variant), a fast approximation is adequate. We use the inverse-CDF method
// via the marsaglia-style approximation from McGrath & Irving (1973). For
// k = 1 (early cold-start) the formula degenerates to a clean exponential.
//
// Returns a sample in (0, 1) representing the inferred success probability.
export function sampleBeta(successCount: number, failureCount: number, rand: () => number = Math.random): number {
  const a = Math.max(0, successCount) + 1
  const b = Math.max(0, failureCount) + 1
  // Use ratio-of-gammas: Beta(a, b) = Gamma(a) / (Gamma(a) + Gamma(b)).
  const x = sampleGamma(a, rand)
  const y = sampleGamma(b, rand)
  if (x + y === 0) return 0.5
  return x / (x + y)
}

// Marsaglia-Tsang gamma sampler (shape >= 1) with shape-augmentation for
// shape < 1. Adequate for prompt-outcome posteriors where shape parameters
// are positive integers; we don't need fractional precision.
function sampleGamma(shape: number, rand: () => number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1, rand) * Math.pow(rand(), 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (let i = 0; i < 64; i++) {
    let x = 0
    let v = 0
    do {
      // Box-Muller for one normal sample.
      const u1 = Math.max(rand(), 1e-12)
      const u2 = rand()
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rand()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
  // Extremely unlikely fallback after 64 rejections; return mean.
  return shape
}

// Exploration constant: reserve this fraction of picks for round-robin
// across all variants regardless of historical Brier. Guards against
// cold-start starvation.
export const EXPLORATION_FRACTION = 0.05

export interface OutcomeStats {
  readonly success: number
  readonly failure: number
}

// Pure Thompson sampling-lite picker. Given a list of variants + their
// historical (success, failure) counts, return the variant whose Beta sample
// is highest. With probability EXPLORATION_FRACTION, override and pick a
// uniformly-random variant instead so cold variants get traffic.
export function pickWithHistory(
  variants: readonly PromptTemplate[],
  history: Map<string, OutcomeStats>,
  rand: () => number = Math.random,
): PromptTemplate | undefined {
  if (variants.length === 0) return undefined
  if (variants.length === 1) return variants[0]

  if (rand() < EXPLORATION_FRACTION) {
    const idx = Math.floor(rand() * variants.length)
    return variants[Math.min(idx, variants.length - 1)]
  }

  let best: { template: PromptTemplate; sample: number } | undefined
  for (const variant of variants) {
    const stats = history.get(variant.variant) ?? { success: 0, failure: 0 }
    const sample = sampleBeta(stats.success, stats.failure, rand)
    if (!best || sample > best.sample) best = { template: variant, sample }
  }
  return best?.template
}

export function pickVariantFromMap(
  byRole: Map<string, PromptTemplate[]>,
  ctx: PickContext,
  history?: Map<string, OutcomeStats>,
): PromptTemplate | undefined {
  const list = byRole.get(ctx.role) ?? []
  if (list.length === 0) return undefined
  if (ctx.forceVariant) {
    const found = list.find((item) => item.variant === ctx.forceVariant)
    if (found) return found
  }
  const rand = ctx.seed ? seededRandom(ctx.seed) : Math.random
  if (history) return pickWithHistory(list, history, rand)
  return weightedPick(list, rand)
}

// Walk a prompts directory and load every .md file as a template entry.
// Returns a flat map of "<role>/<filename>" → raw markdown so buildRegistry
// can parse and bucket. Returns an empty record on missing dir.
export function readPromptDir(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {}
  const files: Record<string, string> = {}
  for (const role of readdirSync(dir, { withFileTypes: true })) {
    if (!role.isDirectory()) continue
    const roleDir = path.join(dir, role.name)
    for (const file of readdirSync(roleDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".md")) continue
      const fullPath = path.join(roleDir, file.name)
      try {
        files[`${role.name}/${file.name}`] = readFileSync(fullPath, "utf-8")
      } catch (err) {
        log.warn("template read failed (skipping)", { file: fullPath, err: String(err) })
      }
    }
  }
  return files
}

// Default location of the bundled-with-source prompt templates. Resolved
// relative to this file so it stays correct in dev (running from `src/`).
function defaultPromptsDir(): string {
  return path.join(import.meta.dirname, "prompts")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let cache: Map<string, PromptTemplate[]> = new Map()

    const loadFiles = () => {
      if (typeof OPENAGT_PROMPT_TEMPLATES !== "undefined") return OPENAGT_PROMPT_TEMPLATES
      const dir = defaultPromptsDir()
      const files = readPromptDir(dir)
      // statSync to surface a clear log line in dev when prompts/ is missing.
      try {
        statSync(dir)
      } catch {
        log.warn("prompts dir missing — registry will be empty", { dir })
      }
      return files
    }

    cache = buildRegistry(loadFiles())
    log.info("loaded prompt templates", {
      roles: cache.size,
      total: [...cache.values()].reduce((acc, list) => acc + list.length, 0),
    })

    const forRole: Interface["forRole"] = (role) => Effect.sync(() => cache.get(role) ?? [])

    const historyForRole = (role: string) =>
      Effect.sync(() => {
        try {
          const since = Date.now() - 30 * 24 * 60 * 60 * 1000
          const rows = Database.use((db) =>
            db
              .select({
                variant: PromptOutcomeTable.variant,
                success: PromptOutcomeTable.success,
              })
              .from(PromptOutcomeTable)
              .where(and(eq(PromptOutcomeTable.role, role), gte(PromptOutcomeTable.time_recorded, since)))
              .all(),
          )
          const history = new Map<string, OutcomeStats>()
          for (const row of rows) {
            const current = history.get(row.variant) ?? { success: 0, failure: 0 }
            history.set(row.variant, {
              success: current.success + (row.success > 0 ? 1 : 0),
              failure: current.failure + (row.success > 0 ? 0 : 1),
            })
          }
          return history
        } catch (err) {
          log.warn("prompt outcome history unavailable", { role, err: String(err) })
          return new Map<string, OutcomeStats>()
        }
      })

    const pickVariant: Interface["pickVariant"] = (ctx, vars, fallback) =>
      Effect.gen(function* () {
        const history = yield* historyForRole(ctx.role)
        const template = pickVariantFromMap(cache, ctx, history)
        if (template) return { template, rendered: renderTemplate(template.content, vars ?? {}) }
        const fallbackText = fallback ? fallback() : ""
        return { template: undefined, rendered: fallbackText }
      })

    const render: Interface["render"] = (template, vars) => renderTemplate(template.content, vars)

    const recordOutcome: Interface["recordOutcome"] = (record) =>
      Effect.sync(() => {
        try {
          const ts = Date.now()
          Database.use((db) =>
            db
              .insert(PromptOutcomeTable)
              .values({
                id: Identifier.ascending("promptOutcome"),
                role: record.role,
                variant: record.variant,
                task_id: record.task_id,
                expert_id: record.expert_id,
                success: record.success ? 1 : 0,
                quality: record.quality,
                duration_ms: record.duration_ms,
                time_recorded: ts,
                time_created: ts,
                time_updated: ts,
              })
              .run(),
          )
        } catch (err) {
          log.warn("prompt outcome record failed", { role: record.role, variant: record.variant, err: String(err) })
        }
      })

    const reload: Interface["reload"] = () =>
      Effect.sync(() => {
        cache = buildRegistry(loadFiles())
        log.info("reloaded prompt templates", {
          roles: cache.size,
          total: [...cache.values()].reduce((acc, list) => acc + list.length, 0),
        })
      })

    return Service.of({ forRole, pickVariant, render, recordOutcome, reload })
  }),
)

// PromptTemplates has no external service dependencies (filesystem reads
// happen at layer init time inline). default = layer.
export const defaultLayer = layer

// =============================================================================
// C.5 — outcome telemetry helpers (DB-backed)
// =============================================================================

// Pure helpers exported here so CLI / tests can read prompt_outcome directly
// without spinning up the Effect Service. Reads are sync, additive, and
// best-effort: missing table downgrades to "no history" rather than throwing.

export interface VariantStats {
  readonly variant: string
  readonly success: number
  readonly failure: number
  readonly total: number
  readonly success_rate: number
  readonly mean_quality: number | undefined
  readonly mean_duration_ms: number | undefined
}

export function summarizeVariantHistory(
  rows: readonly {
    variant: string
    success: number
    quality: number | null
    duration_ms: number | null
  }[],
): VariantStats[] {
  const groups = new Map<
    string,
    { success: number; failure: number; qSum: number; qN: number; dSum: number; dN: number }
  >()
  for (const row of rows) {
    const g = groups.get(row.variant) ?? { success: 0, failure: 0, qSum: 0, qN: 0, dSum: 0, dN: 0 }
    if (row.success > 0) g.success++
    else g.failure++
    if (row.quality !== null && Number.isFinite(row.quality)) {
      g.qSum += row.quality
      g.qN++
    }
    if (row.duration_ms !== null && Number.isFinite(row.duration_ms)) {
      g.dSum += row.duration_ms
      g.dN++
    }
    groups.set(row.variant, g)
  }
  return [...groups.entries()]
    .map(([variant, g]) => {
      const total = g.success + g.failure
      return {
        variant,
        success: g.success,
        failure: g.failure,
        total,
        success_rate: total > 0 ? g.success / total : 0,
        mean_quality: g.qN > 0 ? g.qSum / g.qN : undefined,
        mean_duration_ms: g.dN > 0 ? g.dSum / g.dN : undefined,
      }
    })
    .sort((a, b) => b.success_rate - a.success_rate)
}
