// B.4 — Plan-level enrichment Effect
//
// Fetches relevant semantic facts + procedural recipes from ThreeLayerMemory
// and returns a NEW plan with enriched memory_context. Immutable enrichment so
// callers can compare before/after for telemetry. Returns the unchanged plan
// if the search yields nothing — never produces an empty-but-tagged context
// that would mislead downstream consumers.

import { Cause, Effect } from "effect"
import * as Bus from "@/bus"
import { Event as BehaviorEvent } from "@/bus/behavior-events"
import { Log } from "@/util"
import { Service, enrichMemoryContext, taskSignatureFor } from "./three-layer"

const log = Log.create({ service: "personal.plan-enrichment" })

// Stable djb2 hash of the plan goal so audit consumers can correlate
// behavior.memory.injected with downstream behavior.subagent.dispatched
// events that carry the same goal_hash.
function hashGoal(goal: string): string {
  let hash = 5381
  for (let i = 0; i < goal.length; i++) hash = ((hash << 5) + hash) ^ goal.charCodeAt(i)
  return (hash >>> 0).toString(36)
}

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
    // Wave 6: emit behavior.memory.injected. Both searchSemantic and
    // searchProcedural already filter to kind=fact (Wave 5 Step 5), so the
    // breakdown is currently 100% fact. We still emit the breakdown shape
    // so downstream pipelines have a stable schema once preference/belief
    // notes start flowing through alternative search paths.
    const totalNotes = facts.length + trimmedRecipes.length
    yield* Effect.promise(() =>
      Bus.publish(BehaviorEvent.MemoryInjected, {
        goal_hash: hashGoal(plan.goal),
        note_ids: [...facts.map((f) => f.note_id), ...trimmedRecipes.map((r) => r.note_id)],
        kind_breakdown: { fact: totalNotes, preference: 0, belief: 0 },
        source: "plan_enrichment",
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() =>
          log.warn("behavior event publish failed", {
            event: "memory.injected",
            source: "plan_enrichment",
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    )
    return { ...plan, memory_context: enriched }
  })
