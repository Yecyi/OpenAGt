export * as ExpertRegistry from "./expert-registry"

// ExpertRegistry — runtime registry of coordinator roles.
//
// Conservative DXR (Stream C of the v1.21 plan): the 38 builtin
// CoordinatorNodeRole entries are seeded automatically; user-defined experts
// loaded from `.opencode/experts/*.md` are merged in additively. Every user
// expert MUST `inherits` from a builtin so EffortProfile dispatch (which
// branches on builtin role names) keeps working unchanged.
//
// The registry exposes a query API (`get`, `forWorkflow`, `byDomain`) plus
// inheritance resolution. It does NOT mutate the closed CoordinatorNodeRole
// enum; that change was deferred to a future release per user preference.

import { Context, Effect, Layer } from "effect"
import { Config } from "../config"
import { ConfigExpert } from "../config/expert"
import { CoordinatorNode, CoordinatorNodeRole, type CoordinatorNode as CoordinatorNodeType } from "./schema"
import { Log } from "../util"

const log = Log.create({ service: "expert-registry" })

export interface ExpertEntry {
  readonly role: string
  readonly inherits: string | undefined // undefined for builtins, set for user experts
  readonly source: "builtin" | "user"
  readonly domain: string | undefined
  readonly description: string
  readonly workflows: readonly string[] | undefined
  readonly output_schema: string | undefined
  readonly prompt_template_id: string | undefined
  readonly prompt: string | undefined
  readonly acceptance_checks: readonly string[] | undefined
  readonly memory_namespace: string | undefined
  readonly mpacr_perspective:
    | "factuality"
    | "coherence"
    | "risk"
    | "domain_expertise"
    | "user_value"
    | undefined
}

export interface Interface {
  readonly all: () => Effect.Effect<ExpertEntry[]>
  readonly get: (role: string) => Effect.Effect<ExpertEntry | undefined>
  readonly forWorkflow: (workflow: string) => Effect.Effect<ExpertEntry[]>
  readonly byDomain: (domain: string) => Effect.Effect<ExpertEntry[]>
  // Resolves a (possibly user-defined) role down to its closed-enum builtin
  // ancestor. Returns the role itself if it is already a builtin. Returns
  // undefined if the role has no builtin ancestor (which means it should be
  // rejected by callers — conservative DXR forbids this).
  readonly resolveBuiltinAncestor: (role: string) => Effect.Effect<string | undefined>
  readonly reload: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/ExpertRegistry") {}

const BUILTIN_ROLES: readonly string[] = CoordinatorNodeRole.options

function builtinEntry(role: string): ExpertEntry {
  return {
    role,
    inherits: undefined,
    source: "builtin",
    domain: undefined,
    description: `Builtin coordinator role: ${role}`,
    workflows: undefined,
    output_schema: undefined,
    prompt_template_id: undefined,
    prompt: undefined,
    acceptance_checks: undefined,
    memory_namespace: undefined,
    mpacr_perspective: undefined,
  }
}

function userEntry(role: string, info: ConfigExpert.Info): ExpertEntry {
  return {
    role,
    inherits: info.inherits,
    source: "user",
    domain: info.domain,
    description: info.description,
    workflows: info.workflows,
    output_schema: info.output_schema,
    prompt_template_id: info.prompt_template_id,
    prompt: info.prompt,
    acceptance_checks: info.acceptance_checks,
    memory_namespace: info.memory_namespace,
    mpacr_perspective: info.mpacr_perspective,
  }
}

// Layer seeds builtins + lazily merges user experts from Config on first
// access. Lazy init: the Config.Service read happens at first query, not at
// layer construction, so the layer can be built in test environments that
// don't provide Instance context (Config.get needs Instance).
//
// Errors during validation downgrade to warn-and-skip (matches the
// agent/command loaders) so a single bad .md doesn't crash the registry.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const seedBuiltins = () => {
      const cache = new Map<string, ExpertEntry>()
      for (const role of BUILTIN_ROLES) cache.set(role, builtinEntry(role))
      return cache
    }

    const loadFromConfig = Effect.fn("ExpertRegistry.loadFromConfig")(function* () {
      const cache = seedBuiltins()
      const cfg = yield* config.get().pipe(Effect.catch(() => Effect.succeed({} as Record<string, unknown>)))
      const userExperts = (cfg as { expert?: Record<string, unknown> }).expert ?? {}
      const loaded: Record<string, ConfigExpert.Info> = {}
      for (const [role, raw] of Object.entries(userExperts)) {
        const parsed = ConfigExpert.Info.safeParse(raw)
        if (parsed.success) {
          loaded[role] = parsed.data
        } else {
          log.warn("user expert dropped: failed validation", { role, issues: parsed.error.issues.length })
        }
      }
      mergeUserExperts(cache, loaded, "config")
      log.info("expert registry initialized", {
        builtins: BUILTIN_ROLES.length,
        user_loaded: Object.keys(loaded).length,
        user_provided: Object.keys(userExperts).length,
      })
      return cache
    })

    // Lazy cache: starts as builtin-only; first call to ensure() upgrades it
    // by trying to read Config. If Config read fails (no Instance, e.g. in
    // unit tests), we keep the builtin-only cache and don't retry.
    let cache: Map<string, ExpertEntry> = seedBuiltins()
    let upgraded = false
    const ensure: Effect.Effect<Map<string, ExpertEntry>, never, never> = Effect.gen(function* () {
      if (upgraded) return cache
      const next = yield* loadFromConfig().pipe(
        Effect.catch(() => {
          log.info("expert registry: Config unavailable, using builtins only")
          return Effect.succeed(seedBuiltins())
        }),
      )
      cache = next
      upgraded = true
      return cache
    })

    const all: Interface["all"] = () =>
      Effect.gen(function* () {
        const c = yield* ensure
        return [...c.values()]
      })
    const get: Interface["get"] = (role) =>
      Effect.gen(function* () {
        const c = yield* ensure
        return c.get(role)
      })
    const forWorkflow: Interface["forWorkflow"] = (workflow) =>
      Effect.gen(function* () {
        const c = yield* ensure
        return [...c.values()].filter((entry) => !entry.workflows || entry.workflows.includes(workflow))
      })
    const byDomain: Interface["byDomain"] = (domain) =>
      Effect.gen(function* () {
        const c = yield* ensure
        return [...c.values()].filter((entry) => entry.domain === domain)
      })
    const resolveBuiltinAncestor: Interface["resolveBuiltinAncestor"] = (role) =>
      Effect.gen(function* () {
        const c = yield* ensure
        return resolveBuiltinAncestorImpl(c, role)
      })
    const reload: Interface["reload"] = () =>
      Effect.gen(function* () {
        upgraded = false
        cache = yield* ensure
      })

    return Service.of({ all, get, forWorkflow, byDomain, resolveBuiltinAncestor, reload })
  }),
)

// Layer registered with AppRuntime. Provides Config so the registry can pull
// user expert definitions on first access.
export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

// Side-channel for config.ts to push user-loaded experts in. Validates each
// entry's `inherits` against the builtin list and silently drops the rest.
export function mergeUserExperts(
  cache: Map<string, ExpertEntry>,
  loaded: Record<string, ConfigExpert.Info>,
  origin: string,
) {
  for (const [role, info] of Object.entries(loaded)) {
    if (!BUILTIN_ROLES.includes(info.inherits)) {
      log.warn("user expert rejected: inherits is not a builtin role", {
        role,
        inherits: info.inherits,
        origin,
      })
      continue
    }
    cache.set(role, userEntry(role, info))
  }
}

// Pure variant for unit tests — no Effect runtime, no config dependency.
// Tests can call `buildRegistry({ user: { ... } })` and exercise the
// resolveBuiltinAncestor logic directly.
export function buildRegistry(input: { user?: Record<string, ConfigExpert.Info> }) {
  const map = new Map<string, ExpertEntry>()
  for (const role of BUILTIN_ROLES) map.set(role, builtinEntry(role))
  for (const [role, info] of Object.entries(input.user ?? {})) {
    if (!BUILTIN_ROLES.includes(info.inherits)) continue
    map.set(role, userEntry(role, info))
  }
  return map
}

function resolveBuiltinAncestorImpl(map: Map<string, ExpertEntry>, role: string): string | undefined {
  let cursor = map.get(role)
  const seen = new Set<string>()
  while (cursor && cursor.source === "user") {
    if (seen.has(cursor.role)) return undefined
    seen.add(cursor.role)
    if (!cursor.inherits) return undefined
    cursor = map.get(cursor.inherits)
  }
  return cursor?.source === "builtin" ? cursor.role : undefined
}

export const resolveBuiltinAncestor = resolveBuiltinAncestorImpl

export const BUILTIN_ROLE_LIST: readonly string[] = BUILTIN_ROLES

// C.4 — Additive Merge Layer.
//
// Given a coordinator node (built by the existing `*Node()` factories with a
// builtin `role`) and a user-defined ExpertEntry whose `inherits` matches that
// role, return a new node with:
//   - prompt:          REPLACED by the user's prompt (or template_id reference)
//   - expert_id:       set to the user's namespaced role (e.g. "tax-law-checker")
//   - expert_role:     set to the user's role name
//   - memory_namespace: replaced by the user's namespace, falling back to
//                       `${workflow}:${user_role}`
//   - acceptance_checks: replaced if the user provided them, else preserved
//   - role:            UNCHANGED — stays as the builtin parent so EffortProfile
//                      branching (reviewer_enabled, debugger_enabled, …) keeps
//                      working transparently.
//   - output_schema:   UNCHANGED unless the user explicitly overrode it AND the
//                      override is in CoordinatorOutputSchema (caller should
//                      validate before passing in).
//
// This is the merge contract for the conservative DXR path: closed enum stays
// shut, but user prompts/identities flow through to the dispatched subagent.
export interface ExpertOverrideInput {
  readonly node: CoordinatorNodeType
  readonly entry: ExpertEntry
  // The current workflow — used to compute the default memory_namespace when
  // the entry doesn't specify one.
  readonly workflow?: string
}

export function applyExpertOverride(input: ExpertOverrideInput): CoordinatorNodeType {
  const { node, entry } = input
  if (entry.source !== "user") return node
  if (entry.inherits !== node.role) {
    log.warn("expert override skipped: entry does not inherit from node.role", {
      node_role: node.role,
      entry_role: entry.role,
      entry_inherits: entry.inherits,
    })
    return node
  }
  const workflow = input.workflow ?? node.workflow
  const memoryNamespace =
    entry.memory_namespace ?? (workflow ? `${workflow}:${entry.role}` : `${entry.role}`)
  return CoordinatorNode.parse({
    ...node,
    prompt: entry.prompt ?? node.prompt,
    expert_id: entry.role,
    expert_role: entry.role,
    memory_namespace: memoryNamespace,
    acceptance_checks:
      entry.acceptance_checks && entry.acceptance_checks.length > 0
        ? Array.from(entry.acceptance_checks)
        : node.acceptance_checks,
    // role and output_schema deliberately preserved; EffortProfile dispatch
    // and downstream verdict parsing branch on these.
  })
}

// =============================================================================
// C.4 — Plan-level user-expert override Effect (post-processor)
// =============================================================================

// Loose plan shape so this module doesn't import the heavy CoordinatorPlan
// schema. The coordinator passes its concrete type in.
export interface PlanLikeForExperts {
  readonly workflow?: string
  readonly nodes: readonly CoordinatorNodeType[]
}

// For each plan node, if a user-defined expert exists whose `inherits` matches
// the node.role, apply the override (replaces prompt + expert_id +
// memory_namespace, preserves role + output_schema). Returns a new plan with
// the rewritten nodes; nodes that don't match any user expert pass through
// unchanged.
//
// Selection rule: if multiple user experts inherit from the same builtin role,
// the FIRST registered one wins. This is intentional v1.21 behavior — fancier
// per-domain selection lives in a follow-up.
export const applyUserExpertsToPlan = <P extends PlanLikeForExperts>(
  plan: P,
): Effect.Effect<P, Error, Service> =>
  Effect.gen(function* () {
    const registry = yield* Service
    const all = yield* registry.all()
    const userExperts = all.filter((e) => e.source === "user")
    if (userExperts.length === 0) return plan
    // Index user experts by their parent (inherits) role for O(1) lookup.
    const byParent = new Map<string, ExpertEntry>()
    for (const expert of userExperts) {
      if (!expert.inherits) continue
      if (byParent.has(expert.inherits)) continue // first-wins
      byParent.set(expert.inherits, expert)
    }
    if (byParent.size === 0) return plan
    let touched = 0
    const nodes = plan.nodes.map((node) => {
      const expert = byParent.get(node.role)
      if (!expert) return node
      touched++
      return applyExpertOverride({ node, entry: expert, workflow: plan.workflow })
    })
    if (touched === 0) return plan
    log.info("user-expert overrides applied", { touched, available: userExperts.length })
    return { ...plan, nodes }
  })
