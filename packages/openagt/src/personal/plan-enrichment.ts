// B.4 — Plan-level enrichment Effect
//
// Fetches relevant semantic facts + procedural recipes from ThreeLayerMemory
// and returns a NEW plan with enriched memory_context. Immutable enrichment so
// callers can compare before/after for telemetry. Returns the unchanged plan
// if the search yields nothing — never produces an empty-but-tagged context
// that would mislead downstream consumers.

import { Effect } from "effect"
import { Service, enrichMemoryContext, taskSignatureFor } from "./three-layer"

// Type the plan loosely so this module does not import the heavy
// CoordinatorPlan zod object; the coordinator passes its concrete type in.
export interface PlanLike {
  readonly goal: string
  readonly workflow: string
  readonly memory_context: {
    readonly scopes: readonly string[]
    readonly workflow_tags: readonly string[]
    readonly expert_tags: readonly string[]
    readonly note_ids: readonly string[]
  }
}

export interface EnrichOptions {
  readonly factLimit?: number
  readonly recipeLimit?: number
  readonly minConfidence?: number
}

export const enrichPlanMemory = <P extends PlanLike>(
  plan: P,
  options: EnrichOptions = {},
): Effect.Effect<P, Error, Service> =>
  Effect.gen(function* () {
    const tlm = yield* Service
    const domain = yield* tlm.detectDomain(plan.goal)
    const facts = yield* tlm.searchSemantic({
      query: plan.goal,
      domain,
      limit: options.factLimit ?? 5,
      minConfidence: options.minConfidence ?? 0.5,
    })
    const recipes = yield* tlm.searchProcedural(taskSignatureFor({ goal: plan.goal, workflow: plan.workflow }))
    const trimmedRecipes = recipes.slice(0, options.recipeLimit ?? 3)
    if (facts.length === 0 && trimmedRecipes.length === 0) return plan
    const enriched = enrichMemoryContext({
      base: plan.memory_context,
      facts: facts.map((f) => ({ note_id: f.note_id, domain: f.domain })),
      recipes: trimmedRecipes.map((r) => ({ note_id: r.note_id, domain: r.domain })),
      domain,
    })
    return { ...plan, memory_context: enriched }
  })
