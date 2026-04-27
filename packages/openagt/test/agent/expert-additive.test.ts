import { describe, expect, test } from "bun:test"
import {
  applyExpertOverride,
  buildRegistry,
  resolveBuiltinAncestor,
  type ExpertEntry,
} from "../../src/coordinator/expert-registry"
import { CoordinatorNode } from "../../src/coordinator/schema"

function fakeBuiltinNode(role: string, overrides?: Partial<Parameters<typeof CoordinatorNode.parse>[0]>) {
  return CoordinatorNode.parse({
    id: "test_node",
    description: "Test",
    prompt: "Original builtin prompt",
    task_kind: "verify",
    subagent_type: "general",
    role,
    risk: "low",
    depends_on: [],
    write_scope: [],
    read_scope: [],
    acceptance_checks: ["Builtin acceptance"],
    output_schema: "review",
    requires_user_input: false,
    priority: "normal",
    origin: "coordinator",
    expert_id: `coding.${role}`,
    expert_role: role,
    workflow: "coding",
    memory_namespace: `coding:${role}`,
    ...overrides,
  })
}

function userExpertEntry(overrides: Partial<ExpertEntry> & { role: string; inherits: string }): ExpertEntry {
  return {
    source: "user",
    description: "Custom domain expert",
    domain: "tax-law",
    workflows: undefined,
    output_schema: undefined,
    prompt_template_id: undefined,
    prompt: "You are a tax-law-aware factuality checker. Verify cited regulations.",
    acceptance_checks: ["Cited regulations are real", "Conflicts flagged"],
    memory_namespace: undefined,
    mpacr_perspective: undefined,
    ...overrides,
  } as ExpertEntry
}

describe("applyExpertOverride — happy path", () => {
  test("replaces prompt, expert_id, expert_role, memory_namespace; keeps role", () => {
    const node = fakeBuiltinNode("factuality-checker")
    const entry = userExpertEntry({ role: "tax-law-checker", inherits: "factuality-checker" })

    const merged = applyExpertOverride({ node, entry, workflow: "coding" })

    expect(merged.role).toBe("factuality-checker") // unchanged — closed enum still satisfied
    expect(merged.prompt).toBe("You are a tax-law-aware factuality checker. Verify cited regulations.")
    expect(merged.expert_id).toBe("tax-law-checker")
    expect(merged.expert_role).toBe("tax-law-checker")
    expect(merged.memory_namespace).toBe("coding:tax-law-checker")
  })

  test("uses user-provided memory_namespace verbatim if entry sets one", () => {
    const node = fakeBuiltinNode("factuality-checker")
    const entry = userExpertEntry({
      role: "tax-law-checker",
      inherits: "factuality-checker",
      memory_namespace: "tax-law:scoped-namespace",
    })
    const merged = applyExpertOverride({ node, entry, workflow: "coding" })
    expect(merged.memory_namespace).toBe("tax-law:scoped-namespace")
  })

  test("falls back to node.workflow when no workflow argument is supplied", () => {
    const node = fakeBuiltinNode("factuality-checker", { workflow: "review" })
    const entry = userExpertEntry({ role: "tax-law-checker", inherits: "factuality-checker" })
    const merged = applyExpertOverride({ node, entry })
    expect(merged.memory_namespace).toBe("review:tax-law-checker")
  })

  test("preserves output_schema (downstream verdict parsing depends on it)", () => {
    const node = fakeBuiltinNode("factuality-checker", { output_schema: "review" })
    const entry = userExpertEntry({ role: "tax-law-checker", inherits: "factuality-checker" })
    const merged = applyExpertOverride({ node, entry })
    expect(merged.output_schema).toBe("review")
  })

  test("replaces acceptance_checks when entry provides non-empty list", () => {
    const node = fakeBuiltinNode("factuality-checker")
    const entry = userExpertEntry({
      role: "tax-law-checker",
      inherits: "factuality-checker",
      acceptance_checks: ["Cited regulations are real", "Conflicts flagged"],
    })
    const merged = applyExpertOverride({ node, entry })
    expect(merged.acceptance_checks).toEqual(["Cited regulations are real", "Conflicts flagged"])
  })

  test("keeps builtin acceptance_checks when entry's list is empty", () => {
    const node = fakeBuiltinNode("factuality-checker", { acceptance_checks: ["Builtin acceptance"] })
    const entry = userExpertEntry({
      role: "tax-law-checker",
      inherits: "factuality-checker",
      acceptance_checks: [],
    })
    const merged = applyExpertOverride({ node, entry })
    expect(merged.acceptance_checks).toEqual(["Builtin acceptance"])
  })
})

describe("applyExpertOverride — guard rails", () => {
  test("returns node unchanged when entry.source is 'builtin' (no override needed)", () => {
    const node = fakeBuiltinNode("factuality-checker")
    const builtin: ExpertEntry = {
      role: "factuality-checker",
      inherits: undefined,
      source: "builtin",
      domain: undefined,
      description: "builtin",
      workflows: undefined,
      output_schema: undefined,
      prompt_template_id: undefined,
      prompt: undefined,
      acceptance_checks: undefined,
      memory_namespace: undefined,
      mpacr_perspective: undefined,
    }
    expect(applyExpertOverride({ node, entry: builtin })).toBe(node)
  })

  test("returns node unchanged when entry inherits from a different role", () => {
    const node = fakeBuiltinNode("factuality-checker")
    // User expert that says it inherits from "researcher" — does NOT match this node's role.
    const entry = userExpertEntry({
      role: "wrong-parent-checker",
      inherits: "researcher",
    })
    expect(applyExpertOverride({ node, entry })).toBe(node)
  })

  test("falls back to node.prompt when entry has no prompt body", () => {
    const node = fakeBuiltinNode("factuality-checker", { prompt: "Original builtin prompt" })
    const entry = userExpertEntry({
      role: "tax-law-checker",
      inherits: "factuality-checker",
      prompt: undefined,
    })
    const merged = applyExpertOverride({ node, entry })
    expect(merged.prompt).toBe("Original builtin prompt")
  })
})

describe("buildRegistry + applyExpertOverride end-to-end", () => {
  test("loads user expert via buildRegistry, then merges into a builtin node", () => {
    const registry = buildRegistry({
      user: {
        "tax-law-checker": {
          role: "tax-law-checker",
          inherits: "factuality-checker",
          description: "Verify tax law citations",
          prompt: "You are a tax-law expert. Verify regulations.",
          acceptance_checks: ["Citations resolve"],
        } as any,
      },
    })

    const entry = registry.get("tax-law-checker")
    expect(entry).toBeDefined()
    if (!entry) return

    const node = fakeBuiltinNode("factuality-checker")
    const merged = applyExpertOverride({ node, entry, workflow: "coding" })
    expect(merged.prompt).toBe("You are a tax-law expert. Verify regulations.")
    expect(merged.expert_id).toBe("tax-law-checker")
    expect(merged.acceptance_checks).toEqual(["Citations resolve"])
  })

  test("rejects user experts whose 'inherits' is not a builtin role", () => {
    const registry = buildRegistry({
      user: {
        "rogue-expert": {
          role: "rogue-expert",
          inherits: "nonexistent-builtin",
          description: "should not load",
          prompt: "ignored",
        } as any,
      },
    })
    expect(registry.get("rogue-expert")).toBeUndefined()
  })

  test("resolveBuiltinAncestor walks 'inherits' chain back to a builtin", () => {
    const registry = buildRegistry({
      user: {
        "domain-checker": {
          role: "domain-checker",
          inherits: "factuality-checker",
          description: "domain-aware fact checker",
          prompt: "...",
        } as any,
      },
    })
    expect(resolveBuiltinAncestor(registry, "domain-checker")).toBe("factuality-checker")
    // Builtin role resolves to itself.
    expect(resolveBuiltinAncestor(registry, "factuality-checker")).toBe("factuality-checker")
    // Unknown role — not in registry at all.
    expect(resolveBuiltinAncestor(registry, "unknown")).toBeUndefined()
  })
})
