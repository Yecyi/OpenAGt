// Plan stage builders for coordinator research and verification nodes.
// This file does not apply effort governance, order plans, or run tasks.

import { isProjectDeepDiveGoal } from "@/agent/task-classifier"
import { node } from "./plan-node-factory"
import type { CoordinatorNode as CoordinatorNodeType } from "./schema"

export function researcher(goal: string): CoordinatorNodeType {
  return node({
    id: "research",
    description: "Research context",
    prompt: `Understand the goal and gather the minimum context needed.\n\nGoal: ${goal}`,
    task_kind: "research",
    subagent_type: "explore",
    role: "researcher",
    risk: "low",
    depends_on: [],
    write_scope: [],
    read_scope: [],
    acceptance_checks: ["Relevant context identified"],
    output_schema: "research",
    requires_user_input: false,
    priority: "high",
  })
}

function researcherShard(input: {
  id: string
  description: string
  goal: string
  assignedScope: string[]
  excludedScope?: string[]
  expectedFindings: string[]
}): CoordinatorNodeType {
  return node({
    id: input.id,
    description: input.description,
    prompt: [
      `Explore only your assigned slice of the project for this mission.`,
      `Do not scan the whole repository. Stay within the assigned slice and hand off concise evidence to the reducer.`,
      ``,
      `Goal: ${input.goal}`,
      `Assigned scope: ${input.assignedScope.join(", ")}`,
      input.excludedScope?.length ? `Excluded scope: ${input.excludedScope.join(", ")}` : undefined,
      `Expected findings:`,
      ...input.expectedFindings.map((item) => `- ${item}`),
      ``,
      `Return evidence, confidence, unknowns, and the recommended next step for this slice.`,
    ]
      .filter((item): item is string => Boolean(item))
      .join("\n"),
    task_kind: "research",
    subagent_type: "explore",
    role: "researcher",
    risk: "low",
    depends_on: [],
    write_scope: [],
    read_scope: input.assignedScope,
    parallel_group: "research",
    assigned_scope: input.assignedScope,
    excluded_scope: input.excludedScope ?? [],
    acceptance_checks: input.expectedFindings,
    output_schema: "research",
    requires_user_input: false,
    priority: "high",
  })
}

function parallelResearchers(goal: string): CoordinatorNodeType[] {
  const scopes = [
    {
      id: "research_repo_structure",
      description: "Research repository structure",
      assignedScope: ["workspace structure", "package entrypoints", "module boundaries"],
      expectedFindings: ["Repository structure mapped", "Entrypoints and package relationships identified"],
    },
    {
      id: "research_domain",
      description: "Research domain logic",
      assignedScope: ["core domain modules", "runtime behavior", "existing abstractions"],
      expectedFindings: ["Relevant domain modules identified", "Existing abstractions and contracts summarized"],
    },
    {
      id: "research_tests",
      description: "Research tests and verification",
      assignedScope: ["tests", "typecheck", "lint", "CI and local verification commands"],
      expectedFindings: ["Focused tests and verification commands identified", "Known test risks summarized"],
    },
    {
      id: "research_risk",
      description: "Research risk and permissions",
      assignedScope: ["write boundaries", "permission expectations", "destructive or costly operations"],
      expectedFindings: ["Risk boundaries identified", "Required approvals and write scopes summarized"],
    },
  ]
  return scopes.map((item) =>
    researcherShard({
      ...item,
      goal,
      excludedScope: scopes.filter((scope) => scope.id !== item.id).flatMap((scope) => scope.assignedScope),
    }),
  )
}

function projectDeepDiveResearchers(goal: string): CoordinatorNodeType[] {
  const scopes = [
    {
      id: "research_architecture",
      description: "Research architecture and entrypoints",
      assignedScope: ["package layout", "entrypoints", "runtime boundaries", "server/cli/sdk boundaries"],
      expectedFindings: ["Architecture map produced", "Entrypoints and module boundaries identified"],
    },
    {
      id: "research_agent_runtime",
      description: "Research agent runtime and algorithms",
      assignedScope: [
        "agent loop",
        "prompt assembly",
        "tool registry",
        "subagent orchestration",
        "coordinator runtime",
      ],
      expectedFindings: ["Agent runtime flow summarized", "Subagent and coordinator scheduling algorithms identified"],
    },
    {
      id: "research_data_safety",
      description: "Research state, memory, safety, and events",
      assignedScope: [
        "session memory",
        "personal memory",
        "database storage",
        "permission and shell safety",
        "event bus and SSE",
      ],
      expectedFindings: ["State and memory model summarized", "Safety envelope and event flow identified"],
    },
    {
      id: "research_tests_release",
      description: "Research verification, SDK, docs, and release",
      assignedScope: ["tests", "typecheck", "release scripts", "OpenAPI and SDK", "documentation"],
      expectedFindings: ["Verification matrix identified", "Release and SDK integration points summarized"],
    },
  ]
  return scopes.map((item) =>
    researcherShard({
      ...item,
      goal,
      excludedScope: scopes.filter((scope) => scope.id !== item.id).flatMap((scope) => scope.assignedScope),
    }),
  )
}

function researchersForGoal(goal: string): CoordinatorNodeType[] {
  if (isProjectDeepDiveGoal(goal)) return projectDeepDiveResearchers(goal)
  return parallelResearchers(goal)
}

function researchReducer(goal: string, dependsOn: string[]): CoordinatorNodeType {
  const projectDeepDive = isProjectDeepDiveGoal(goal)
  return node({
    id: "research_synthesis",
    description: "Merge parallel research",
    prompt: [
      `Merge the completed parallel researcher outputs into a compact handoff for later agents.`,
      ``,
      `Goal: ${goal}`,
      ``,
      `Deduplicate overlapping findings, mark conflicts explicitly, and do not invent facts missing from evidence.`,
      projectDeepDive
        ? `For project deep dives, produce a technical architecture outline covering core subsystems, key algorithms, data flows, safety/runtime boundaries, important files, extension points, risks, and unknowns.`
        : undefined,
      `Output fields: summary, key_files, architecture_map, risks, recommended_plan_changes, open_questions, confidence.`,
    ]
      .filter((item): item is string => Boolean(item))
      .join("\n"),
    task_kind: "generic",
    subagent_type: "general",
    role: "reducer",
    risk: "low",
    depends_on: dependsOn,
    write_scope: [],
    read_scope: [],
    merge_status: "waiting",
    acceptance_checks: ["Parallel research merged", "Conflicts and unknowns marked"],
    output_schema: "research-synthesis",
    requires_user_input: false,
    priority: "high",
  })
}

export function parallelResearchStage(goal: string): CoordinatorNodeType[] {
  const research = researchersForGoal(goal)
  return [
    ...research,
    researchReducer(
      goal,
      research.map((item) => item.id),
    ),
  ]
}

function verifierShard(input: {
  id: string
  description: string
  goal: string
  dependsOn: string[]
  checks: string[]
}): CoordinatorNodeType {
  return node({
    id: input.id,
    description: input.description,
    prompt: [
      `Verify exactly one quality dimension for this mission.`,
      ``,
      `Goal: ${input.goal}`,
      `Verification focus:`,
      ...input.checks.map((item) => `- ${item}`),
      ``,
      `Return evidence, command/output summaries when available, confidence, and residual risk.`,
    ].join("\n"),
    task_kind: "verify",
    subagent_type: "general",
    role: "verifier",
    risk: "low",
    depends_on: input.dependsOn,
    write_scope: [],
    read_scope: [],
    parallel_group: "verify",
    assigned_scope: input.checks,
    acceptance_checks: input.checks,
    output_schema: "verification",
    requires_user_input: false,
    priority: "normal",
  })
}

export function parallelVerificationStage(goal: string, dependsOn: string[]): CoordinatorNodeType[] {
  return [
    verifierShard({
      id: "verify_typecheck",
      description: "Verify typecheck/static contracts",
      goal,
      dependsOn,
      checks: ["Typecheck or static contract verification completed"],
    }),
    verifierShard({
      id: "verify_focused_tests",
      description: "Verify focused tests",
      goal,
      dependsOn,
      checks: ["Focused tests or a concrete test gap report completed"],
    }),
    verifierShard({
      id: "verify_acceptance",
      description: "Verify acceptance criteria",
      goal,
      dependsOn,
      checks: ["Acceptance criteria checked against the result"],
    }),
  ]
}
