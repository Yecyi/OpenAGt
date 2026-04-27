import { describe, expect, test } from "bun:test"
import {
  applyUserExpertsToPlan,
  buildRegistry,
  Service as ExpertRegistryService,
  type ExpertEntry,
} from "../../src/coordinator/expert-registry"
import { Effect, Layer } from "effect"
import {
  enrichMemoryContext,
  taskSignatureFor,
} from "../../src/personal/three-layer"
import { settleIntentProfile, basePlanForIntent } from "../../src/coordinator/coordinator"

// Sanity check the v1.21 plan-creation pipeline post-processors work as a
// composable chain — each is independently tested, but this test confirms
// they don't interfere when applied sequentially.

describe("v1.21 plan post-processor pipeline (3LMA enrich → C.4 user-expert override)", () => {
  test("enrichMemoryContext + applyUserExpertsToPlan compose without conflict", async () => {
    const intent = settleIntentProfile({ goal: "implement mission control backend api" })
    const base = basePlanForIntent(intent)

    // Step 1: simulate enrichPlanMemory output (just the pure enrichment).
    const sig = taskSignatureFor({ goal: base.goal, workflow: base.workflow })
    // Signature is `${workflow}:${domain}:${keywords}`. Workflow comes from
    // settleIntentProfile; we just assert it's well-formed (3 colon-separated parts).
    expect(sig.split(":").length).toBeGreaterThanOrEqual(3)
    expect(sig.startsWith(`${base.workflow}:`)).toBe(true)
    const enriched = enrichMemoryContext({
      base: base.memory_context,
      facts: [{ note_id: "fact_1", domain: "coding" }],
      recipes: [{ note_id: "recipe_1", domain: "coding" }],
      domain: "coding",
    })
    const planAfterEnrich = { ...base, memory_context: enriched }
    expect(planAfterEnrich.memory_context.note_ids).toContain("fact_1")
    expect(planAfterEnrich.memory_context.note_ids).toContain("recipe_1")
    expect(planAfterEnrich.memory_context.scopes).toContain("semantic")

    // Step 2: stub a user expert that overrides factuality-checker, then
    // apply via applyUserExpertsToPlan with a fixture registry.
    const registry = buildRegistry({
      user: {
        "coding-fact-checker": {
          role: "coding-fact-checker",
          inherits: "factuality-checker",
          description: "Coding-flavored fact checker",
          prompt: "Verify code-related facts",
        } as any,
      },
    })

    const stubLayer = Layer.succeed(ExpertRegistryService, {
      all: () => Effect.sync(() => [...registry.values()]),
      get: (role: string) => Effect.sync(() => registry.get(role)),
      forWorkflow: () => Effect.sync(() => [...registry.values()]),
      byDomain: () => Effect.sync(() => []),
      resolveBuiltinAncestor: () => Effect.sync(() => undefined),
      reload: () => Effect.void,
    } as Parameters<typeof ExpertRegistryService.of>[0])

    const planAfterOverride = await Effect.runPromise(
      applyUserExpertsToPlan(planAfterEnrich).pipe(Effect.provide(stubLayer)),
    )

    // Memory context survives the override (override only touches nodes).
    expect(planAfterOverride.memory_context.note_ids).toEqual(planAfterEnrich.memory_context.note_ids)
    // Base plan for "coding" workflow doesn't contain a factuality-checker
    // node, so override is a no-op for THIS plan, but the chain runs cleanly.
    expect(planAfterOverride.nodes.length).toBe(planAfterEnrich.nodes.length)
  })

  test("applyUserExpertsToPlan returns the same plan reference when no user experts are registered", async () => {
    const intent = settleIntentProfile({ goal: "review this auth module change" })
    const base = basePlanForIntent(intent)
    const registry = buildRegistry({}) // builtins only
    const stubLayer = Layer.succeed(ExpertRegistryService, {
      all: () => Effect.sync(() => [...registry.values()]),
      get: () => Effect.sync(() => undefined),
      forWorkflow: () => Effect.sync(() => []),
      byDomain: () => Effect.sync(() => []),
      resolveBuiltinAncestor: () => Effect.sync(() => undefined),
      reload: () => Effect.void,
    } as Parameters<typeof ExpertRegistryService.of>[0])

    const result = await Effect.runPromise(applyUserExpertsToPlan(base).pipe(Effect.provide(stubLayer)))
    // Same nodes (no override applied).
    expect(result.nodes).toBe(base.nodes)
  })

  test("applyUserExpertsToPlan rewrites a node when its role matches a user expert's inherits", async () => {
    const intent = settleIntentProfile({ goal: "implement api change" })
    const base = basePlanForIntent(intent)

    // Find a builtin role present in the base plan to target — researcher is
    // present in every coding plan via parallelResearchStage.
    const researcher = base.nodes.find((n) => n.role === "researcher")
    expect(researcher).toBeDefined()
    if (!researcher) return

    const userEntry: ExpertEntry = {
      role: "domain-researcher",
      inherits: "researcher",
      source: "user",
      description: "domain-aware researcher",
      domain: "coding",
      workflows: undefined,
      output_schema: undefined,
      prompt_template_id: undefined,
      prompt: "You are a domain-aware researcher. Walk the architecture.",
      acceptance_checks: ["Architecture surfaced"],
      memory_namespace: undefined,
      mpacr_perspective: undefined,
    }
    const registry = new Map<string, ExpertEntry>([
      ["researcher", { ...userEntry, role: "researcher", source: "builtin", inherits: undefined }],
      ["domain-researcher", userEntry],
    ])
    const stubLayer = Layer.succeed(ExpertRegistryService, {
      all: () => Effect.sync(() => [...registry.values()]),
      get: (role: string) => Effect.sync(() => registry.get(role)),
      forWorkflow: () => Effect.sync(() => [...registry.values()]),
      byDomain: () => Effect.sync(() => []),
      resolveBuiltinAncestor: () => Effect.sync(() => undefined),
      reload: () => Effect.void,
    } as Parameters<typeof ExpertRegistryService.of>[0])

    const result = await Effect.runPromise(applyUserExpertsToPlan(base).pipe(Effect.provide(stubLayer)))
    const overriddenResearcher = result.nodes.find((n) => n.role === "researcher")
    expect(overriddenResearcher?.expert_id).toBe("domain-researcher")
    expect(overriddenResearcher?.prompt).toContain("domain-aware researcher")
    // Role stays "researcher" so EffortProfile dispatch keeps working.
    expect(overriddenResearcher?.role).toBe("researcher")
  })
})
