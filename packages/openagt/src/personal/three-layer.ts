export * as ThreeLayerMemory from "./three-layer"

// Three-Layer Memory Architecture (3LMA) — B.2 of the v1.21 plan.
//
// Adds the semantic and procedural layers on top of the existing episodic
// memory (profile/workspace/session). All four layers share the same
// `personal_memory_note` table — a fact is just a note with `scope: "semantic"`
// and metadata carrying the (subject, predicate, object) triple.
//
// The service is a thin adapter over PersonalAgent: it shapes inputs into the
// remember()/searchMemory() contract, and exposes domain-aware query helpers.
//
// Embeddings are deliberately NOT introduced (see plan §6 / user decision).
// Retrieval reuses the existing FTS5/BM25 index on personal_memory_note.

import { Context, Effect, Layer } from "effect"
import z from "zod"
import { Service as PersonalAgentService, defaultLayer as personalDefaultLayer } from "./personal"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import {
  type MemoryNote as MemoryNoteType,
  type MemoryScope as MemoryScopeType,
  type MemorySearchResult as MemorySearchResultType,
} from "./schema"

export const SemanticFactInput = z.object({
  domain: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.5),
  source_note_ids: z.array(z.string()).default([]),
  rehearsal_count: z.number().int().min(0).default(0),
  // Optional: link the fact to a specific session/project so we can audit
  // provenance later. For cross-session facts these are intentionally omitted.
  projectID: z.string().optional(),
  sessionID: z.string().optional(),
})
export type SemanticFactInput = z.infer<typeof SemanticFactInput>

export const ProceduralRecipeInput = z.object({
  task_signature: z.string().min(1),
  domain: z.string().min(1),
  // Free-form list of plan steps; each step references the expert/role used.
  steps: z
    .array(
      z.object({
        description: z.string(),
        role: z.string().optional(),
        expert_id: z.string().optional(),
      }),
    )
    .min(1),
  success_count: z.number().int().min(0).default(1),
  failure_count: z.number().int().min(0).default(0),
  mean_duration_ms: z.number().int().min(0).optional(),
  pitfalls_avoided: z.array(z.string()).default([]),
})
export type ProceduralRecipeInput = z.infer<typeof ProceduralRecipeInput>

export const SemanticFact = z.object({
  note_id: z.string(),
  domain: z.string(),
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  confidence: z.number().min(0).max(1),
  source_note_ids: z.array(z.string()),
  rehearsal_count: z.number().int(),
})
export type SemanticFact = z.infer<typeof SemanticFact>

export const ProceduralRecipe = z.object({
  note_id: z.string(),
  domain: z.string(),
  task_signature: z.string(),
  steps: z.array(
    z.object({
      description: z.string(),
      role: z.string().optional(),
      expert_id: z.string().optional(),
    }),
  ),
  success_count: z.number().int(),
  failure_count: z.number().int(),
  mean_duration_ms: z.number().int().optional(),
  pitfalls_avoided: z.array(z.string()),
})
export type ProceduralRecipe = z.infer<typeof ProceduralRecipe>

// Pure helpers — no Effect, no DB. Used by the service and the consolidator.
export function makeSemanticTitle(input: { subject: string; predicate: string; object: string }) {
  // Keep title under FTS5's typical token limit and human-readable.
  const trimmed = `${input.subject} ${input.predicate} ${input.object}`.slice(0, 200)
  return trimmed
}

export function semanticMetadata(input: SemanticFactInput): Record<string, unknown> {
  return {
    layer: "semantic",
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    confidence: input.confidence,
    source_note_ids: input.source_note_ids,
    rehearsal_count: input.rehearsal_count,
    domain: input.domain,
  }
}

export function proceduralMetadata(input: ProceduralRecipeInput): Record<string, unknown> {
  return {
    layer: "procedural",
    task_signature: input.task_signature,
    steps: input.steps,
    success_count: input.success_count,
    failure_count: input.failure_count,
    mean_duration_ms: input.mean_duration_ms,
    pitfalls_avoided: input.pitfalls_avoided,
    domain: input.domain,
  }
}

// Tag conventions:
//   semantic:  ["domain:<d>", "fact", "predicate:<p>"]
//   procedural: ["domain:<d>", "recipe", "task_sig:<sha>"]
export function semanticTags(input: SemanticFactInput): string[] {
  return [`domain:${input.domain}`, "fact", `predicate:${input.predicate}`]
}
export function proceduralTags(input: ProceduralRecipeInput): string[] {
  return [`domain:${input.domain}`, "recipe", `task_sig:${input.task_signature}`]
}

// Lightweight goal -> domain classifier. Reads vocabulary lists from a small
// in-process map. Each domain's list is intentionally polyglot — English,
// Chinese, and other CJK terms live side-by-side so a single matcher works
// across languages. C2 intent: an LLM-based refiner can later replace this
// when settleIntentProfile gains an Effect signature; for now the keyword
// classifier is the canonical entry point and is also exposed via the
// IntentProfile.domain field set in coordinator/intent-profile.ts.
const DOMAIN_KEYWORDS: Record<string, readonly string[]> = {
  coding: [
    "code",
    "function",
    "module",
    "package",
    "api",
    "test",
    "repo",
    "代码",
    "函数",
    "模块",
    "接口",
    "测试",
    "仓库",
    "编程",
    "重构",
  ],
  research: [
    "research",
    "paper",
    "literature",
    "study",
    "explore",
    "summarize",
    "研究",
    "论文",
    "文献",
    "调研",
    "综述",
    "总结",
  ],
  writing: ["draft", "write", "essay", "letter", "memo", "blog", "起草", "撰写", "文章", "信件", "备忘", "博客", "文案"],
  "data-analysis": [
    "dataset",
    "csv",
    "table",
    "stats",
    "analysis",
    "chart",
    "数据集",
    "表格",
    "统计",
    "分析",
    "图表",
    "数据",
  ],
  "personal-admin": [
    "calendar",
    "schedule",
    "inbox",
    "email",
    "task",
    "remind",
    "日历",
    "日程",
    "收件箱",
    "邮件",
    "待办",
    "提醒",
  ],
  finance: [
    "budget",
    "tax",
    "invoice",
    "expense",
    "deduction",
    "ledger",
    "预算",
    "税",
    "发票",
    "支出",
    "财务",
    "账目",
    "报销",
  ],
  health: ["doctor", "appointment", "symptom", "prescription", "diet", "医生", "预约", "症状", "处方", "饮食", "健康"],
  legal: ["regulation", "compliance", "contract", "clause", "statute", "法规", "合规", "合同", "条款", "法律", "条例"],
}

export function detectDomain(goal: string): string {
  const lower = goal.toLowerCase()
  let best = { domain: "general", score: 0 }
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const hits = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0)
    if (hits > best.score) best = { domain, score: hits }
  }
  return best.domain
}

// =============================================================================
// B.4 — Coordinator integration helpers
// =============================================================================

// Stable lookup key for procedural recipes. Two goals that share the same
// (workflow, domain, top-3 keywords) sets get the same signature so a recipe
// recorded for one task is reusable for the next. Sorting BEFORE slicing
// ensures word-order in the goal text doesn't change the signature.
//
// `domain` may be passed explicitly when the caller already has it from
// IntentProfile.domain (avoids re-running detectDomain). Falls back to
// re-deriving from the goal otherwise.
export function taskSignatureFor(input: { goal: string; workflow: string; domain?: string }): string {
  const domain = input.domain ?? detectDomain(input.goal)
  const keywords = extractKeywords(input.goal).sort().slice(0, 3).join(",")
  return `${input.workflow}:${domain}:${keywords}`
}

// Lowercase, alpha-only words ≥ 4 chars, deduped, common stopwords stripped.
// Deliberately tiny — a stable signature, not a search query.
const STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "about",
  "into",
  "make",
  "your",
  "their",
  "should",
  "would",
  "could",
  "there",
  "where",
  "which",
  "while",
  "what",
  "when",
  "they",
  "them",
  "been",
  "were",
  "will",
  "than",
  "then",
])
export function extractKeywords(goal: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of goal.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue
    if (STOPWORDS.has(raw)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push(raw)
  }
  return out
}

// Pure: enrich a CoordinatorPlan's memory_context with note IDs from semantic
// + procedural lookups. Caller fetches via ThreeLayerMemory and passes the
// results in. Keeps the function side-effect free for tests + idempotent for
// callers (re-running yields the same enrichment).
export interface MemoryEnrichmentInput {
  readonly base: {
    readonly scopes: readonly string[]
    readonly workflow_tags: readonly string[]
    readonly expert_tags: readonly string[]
    readonly note_ids: readonly string[]
  }
  readonly facts: readonly { note_id: string; domain: string }[]
  readonly recipes: readonly { note_id: string; domain: string }[]
  readonly domain: string
}

export interface EnrichedMemoryContext {
  readonly scopes: string[]
  readonly workflow_tags: string[]
  readonly expert_tags: string[]
  readonly note_ids: string[]
}

export function enrichMemoryContext(input: MemoryEnrichmentInput): EnrichedMemoryContext {
  // Dedupe: a fact and a recipe might share a note_id (unlikely but possible).
  const allNoteIds = new Set<string>([
    ...input.base.note_ids,
    ...input.facts.map((f) => f.note_id),
    ...input.recipes.map((r) => r.note_id),
  ])
  // Always include the active domain in workflow_tags so downstream services
  // can filter or weight by domain.
  const tags = new Set<string>([...input.base.workflow_tags, `domain:${input.domain}`])
  // Expand scopes to cover semantic + procedural so downstream searchMemory
  // calls reach the new layers when they look at the plan's memory_context.
  const scopes = new Set<string>([...input.base.scopes, "semantic", "procedural"])
  return {
    scopes: [...scopes],
    workflow_tags: [...tags],
    expert_tags: [...input.base.expert_tags],
    note_ids: [...allNoteIds],
  }
}

function readSemanticFromNote(note: MemoryNoteType): SemanticFact | undefined {
  const meta = note.metadata as Record<string, unknown> | undefined
  if (!meta || meta.layer !== "semantic") return undefined
  const subject = typeof meta.subject === "string" ? meta.subject : undefined
  const predicate = typeof meta.predicate === "string" ? meta.predicate : undefined
  const object = typeof meta.object === "string" ? meta.object : undefined
  const domain = typeof meta.domain === "string" ? meta.domain : undefined
  if (!subject || !predicate || !object || !domain) return undefined
  return {
    note_id: note.id,
    domain,
    subject,
    predicate,
    object,
    confidence: typeof meta.confidence === "number" ? meta.confidence : 0.5,
    source_note_ids: Array.isArray(meta.source_note_ids)
      ? (meta.source_note_ids.filter((v) => typeof v === "string") as string[])
      : [],
    rehearsal_count: typeof meta.rehearsal_count === "number" ? meta.rehearsal_count : 0,
  }
}

function readProceduralFromNote(note: MemoryNoteType): ProceduralRecipe | undefined {
  const meta = note.metadata as Record<string, unknown> | undefined
  if (!meta || meta.layer !== "procedural") return undefined
  const taskSig = typeof meta.task_signature === "string" ? meta.task_signature : undefined
  const domain = typeof meta.domain === "string" ? meta.domain : undefined
  if (!taskSig || !domain) return undefined
  const steps = Array.isArray(meta.steps)
    ? (meta.steps.filter(
        (s): s is { description: string; role?: string; expert_id?: string } =>
          typeof s === "object" && s !== null && "description" in s,
      ) as { description: string; role?: string; expert_id?: string }[])
    : []
  return {
    note_id: note.id,
    domain,
    task_signature: taskSig,
    steps,
    success_count: typeof meta.success_count === "number" ? meta.success_count : 0,
    failure_count: typeof meta.failure_count === "number" ? meta.failure_count : 0,
    mean_duration_ms: typeof meta.mean_duration_ms === "number" ? meta.mean_duration_ms : undefined,
    pitfalls_avoided: Array.isArray(meta.pitfalls_avoided)
      ? (meta.pitfalls_avoided.filter((v) => typeof v === "string") as string[])
      : [],
  }
}

export interface SearchSemanticInput {
  readonly query: string
  readonly domain?: string
  readonly limit?: number
  readonly minConfidence?: number
}

export interface Interface {
  readonly recordSemanticFact: (input: SemanticFactInput) => Effect.Effect<SemanticFact, Error>
  readonly recordProceduralRecipe: (input: ProceduralRecipeInput) => Effect.Effect<ProceduralRecipe, Error>
  readonly searchSemantic: (input: SearchSemanticInput) => Effect.Effect<SemanticFact[], Error>
  readonly searchProcedural: (taskSignature: string) => Effect.Effect<ProceduralRecipe[], Error>
  readonly detectDomain: (goal: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/ThreeLayerMemory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const personal = yield* PersonalAgentService

    const recordSemanticFact: Interface["recordSemanticFact"] = Effect.fn("ThreeLayer.recordSemanticFact")(
      function* (input) {
        const parsed = SemanticFactInput.parse(input)
        const note = yield* personal.remember({
          scope: "semantic" as MemoryScopeType,
          // Wave 5: semantic facts are empirical (subject, predicate, object)
          // claims about the world or codebase. Tag as fact so the
          // critic-isolation filter (`kinds: ["fact"]`) returns them.
          kind: "fact",
          title: makeSemanticTitle(parsed),
          content: `${parsed.subject} ${parsed.predicate} ${parsed.object}`,
          projectID: parsed.projectID as ProjectID | undefined,
          sessionID: parsed.sessionID as SessionID | undefined,
          tags: semanticTags(parsed),
          metadata: semanticMetadata(parsed),
          source: "coordinator",
          importance: Math.round(parsed.confidence * 10),
          pinned: false,
        })
        const fact = readSemanticFromNote(note)
        if (!fact) {
          return yield* Effect.fail(
            new Error(`semantic fact note ${note.id} did not round-trip — metadata layer mismatch`),
          )
        }
        return fact
      },
    )

    const recordProceduralRecipe: Interface["recordProceduralRecipe"] = Effect.fn(
      "ThreeLayer.recordProceduralRecipe",
    )(function* (input) {
      const parsed = ProceduralRecipeInput.parse(input)
      const successRate = parsed.success_count / Math.max(1, parsed.success_count + parsed.failure_count)
      const note = yield* personal.remember({
        scope: "procedural" as MemoryScopeType,
        // Wave 5: procedural recipes are observed-to-work patterns —
        // empirical claims about which step sequences succeed. Tag as
        // fact so the critic-isolation filter returns them.
        kind: "fact",
        title: `Recipe: ${parsed.task_signature}`,
        content: parsed.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n"),
        tags: proceduralTags(parsed),
        metadata: proceduralMetadata(parsed),
        source: "coordinator",
        importance: Math.round(successRate * 10),
        pinned: false,
      })
      const recipe = readProceduralFromNote(note)
      if (!recipe) {
        return yield* Effect.fail(
          new Error(`procedural recipe note ${note.id} did not round-trip — metadata layer mismatch`),
        )
      }
      return recipe
    })

    const searchSemantic: Interface["searchSemantic"] = Effect.fn("ThreeLayer.searchSemantic")(function* (input) {
      const limit = input.limit ?? 5
      const minConfidence = input.minConfidence ?? 0.5
      // Wave 5: semantic scope is supposed to hold empirical claims; restrict
      // to kind=fact so a stray non-fact note in this scope cannot leak in
      // as a "fact". Belt and suspenders — Wave 5 Step 3 already classifies
      // recordSemanticFact's writes as fact.
      const results: MemorySearchResultType[] = yield* personal.searchMemory({
        query: input.query,
        scopes: ["semantic"],
        kinds: ["fact"],
      })
      // Apply domain + confidence filters in-process; FTS5 handles the BM25 ranking.
      const facts = results
        .map((r) => readSemanticFromNote(r))
        .filter((f): f is SemanticFact => f !== undefined)
        .filter((f) => (input.domain ? f.domain === input.domain : true))
        .filter((f) => f.confidence >= minConfidence)
      return facts.slice(0, limit)
    })

    const searchProcedural: Interface["searchProcedural"] = Effect.fn("ThreeLayer.searchProcedural")(
      function* (taskSignature) {
        // Procedural recipes are indexed by task_signature in tags. We do an FTS
        // query over the tag prefix; the consolidator (B.3) will keep tags
        // canonicalized.
        // Wave 5: same belt-and-suspenders as searchSemantic — only return
        // kind=fact procedural notes (the recordProceduralRecipe write site
        // already sets kind=fact).
        const results = yield* personal.searchMemory({
          query: `task_sig:${taskSignature}`,
          scopes: ["procedural"],
          kinds: ["fact"],
        })
        return results
          .map((r) => readProceduralFromNote(r))
          .filter((r): r is ProceduralRecipe => r !== undefined)
          .filter((r) => r.task_signature === taskSignature)
      },
    )

    const detectDomainFn: Interface["detectDomain"] = (goal) => Effect.sync(() => detectDomain(goal))

    return Service.of({
      recordSemanticFact,
      recordProceduralRecipe,
      searchSemantic,
      searchProcedural,
      detectDomain: detectDomainFn,
    })
  }),
)

// Provides PersonalAgent so this layer can call remember()/searchMemory().
export const defaultLayer = Layer.suspend(() => layer.pipe(Layer.provide(personalDefaultLayer)))

export { enrichPlanMemory, type PlanLike, type EnrichOptions } from "./plan-enrichment"
