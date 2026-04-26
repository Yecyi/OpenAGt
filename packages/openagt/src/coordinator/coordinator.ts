import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider"
import { Database, desc, eq } from "@/storage"
import { Cause, Context, Effect, Layer, Option, Scope } from "effect"
import { existsSync, readdirSync } from "fs"
import path from "path"
import z from "zod"
import { CoordinatorRunTable } from "./coordinator.sql"
import { isBroadAgentTask } from "@/agent/task-classifier"
import {
  CoordinatorNode,
  CoordinatorPlan,
  CoordinatorRun,
  CoordinatorRunID,
  CoordinatorMode,
  EffortLevel,
  EffortProfile,
  ExpertLane,
  LongTaskProfile,
  QualityGate,
  ParallelExecutionPolicy,
  RevisePoint,
  IntentProfile,
  TaskType,
  TodoTimeline,
  BudgetProfile,
  BudgetState,
  ProgressSnapshot,
  CheckpointMemorySummary,
  ContinuationRequest,
  CriticalReviewVerdict,
  ResourceLimit,
  type CoordinatorNode as CoordinatorNodeType,
  type CoordinatorNodeInput,
  type AutoContinuePolicy as AutoContinuePolicyType,
  type BudgetScale as BudgetScaleType,
  type BudgetProfile as BudgetProfileType,
  type CheckpointMemorySummary as CheckpointMemorySummaryType,
  type EffortLevel as EffortLevelType,
  type EffortProfile as EffortProfileType,
  type LongTaskProfile as LongTaskProfileType,
  type ProgressSnapshot as ProgressSnapshotType,
  type CoordinatorMode as CoordinatorModeType,
  type CoordinatorPlan as CoordinatorPlanType,
  type CoordinatorRun as CoordinatorRunType,
  type CoordinatorRunID as CoordinatorRunIDType,
  type CriticalReviewVerdict as CriticalReviewVerdictType,
  type IntentProfile as IntentProfileType,
  type ParallelExecutionPolicy as ParallelExecutionPolicyType,
  type ResourceLimit as ResourceLimitType,
  type TaskType as TaskTypeType,
  type TodoTimeline as TodoTimelineType,
} from "./schema"

function now() {
  return Date.now()
}

function hasAny(value: string, terms: string[]) {
  return terms.some((item) => value.includes(item))
}

type WorkspaceSignals = {
  file_count: number
  package_count: number
  language_count: number
  reasons: string[]
}

function safeReaddir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true }).slice(0, 256)
  } catch {
    return []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function workspaceSignalsForGoal(goal: string): WorkspaceSignals {
  if (!isProjectDeepDiveGoal(goal)) {
    return { file_count: 0, package_count: 0, language_count: 0, reasons: [] }
  }
  const root = process.cwd()
  const ignored = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage", ".artifacts"])
  const extensions = new Set<string>()
  const seenPackages = { value: 0 }
  const scan = (dir: string, remaining: number): number => {
    if (remaining <= 0) return 0
    if (!existsSync(dir)) return 0
    return safeReaddir(dir).reduce((count, entry) => {
      if (count >= remaining) return count
      if (ignored.has(entry.name)) return count
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return count + scan(full, remaining - count)
      if (!entry.isFile()) return count
      if (entry.name === "package.json") seenPackages.value += 1
      const ext = path.extname(entry.name).toLowerCase()
      if (ext) extensions.add(ext)
      return count + 1
    }, 0)
  }
  const file_count = scan(root, 2_000)
  const package_count =
    seenPackages.value +
    (existsSync(path.join(root, "bun.lock")) || existsSync(path.join(root, "pnpm-lock.yaml")) ? 1 : 0)
  const language_count = extensions.size
  return {
    file_count,
    package_count,
    language_count,
    reasons: [
      file_count >= 100 ? `workspace has at least ${file_count} scanned files` : undefined,
      package_count >= 2 ? `workspace has ${package_count} package or lockfile markers` : undefined,
      language_count >= 4 ? `workspace has ${language_count} file extension families` : undefined,
    ].filter((item): item is string => Boolean(item)),
  }
}

function isProjectDeepDiveGoal(goal: string) {
  const normalized = goal.toLowerCase()
  return (
    isBroadAgentTask(goal) &&
    (hasAny(normalized, [
      "project",
      "codebase",
      "repo",
      "repository",
      "architecture",
      "runtime",
      "algorithm",
      "algor",
    ]) ||
      hasAny(goal, ["项目", "代码库", "仓库", "架构", "运行时", "算法"]))
  )
}

export function effortProfileFor(effort: EffortLevelType): EffortProfileType {
  return EffortProfile.parse(
    effort === "low"
      ? {
          planning_rounds: 1,
          expert_count_min: 1,
          expert_count_max: 1,
          verifier_count_min: 0,
          reducer_enabled: false,
          reviewer_enabled: false,
          debugger_enabled: false,
          revise_policy: "none",
          max_revise_nodes: 0,
          max_revision_per_artifact: 0,
          reasoning_effort: "low",
          timeout_multiplier: 0.75,
        }
      : effort === "high"
        ? {
            planning_rounds: 2,
            expert_count_min: 2,
            expert_count_max: 4,
            verifier_count_min: 1,
            reducer_enabled: true,
            reviewer_enabled: true,
            debugger_enabled: false,
            revise_policy: "critical_only",
            max_revise_nodes: 6,
            max_revision_per_artifact: 1,
            reasoning_effort: "high",
            timeout_multiplier: 1.5,
          }
        : effort === "deep"
          ? {
              planning_rounds: 3,
              expert_count_min: 3,
              expert_count_max: 6,
              verifier_count_min: 2,
              reducer_enabled: true,
              reviewer_enabled: true,
              debugger_enabled: true,
              revise_policy: "all_artifacts",
              max_revise_nodes: 24,
              max_revision_per_artifact: 2,
              reasoning_effort: "high",
              timeout_multiplier: 3,
            }
          : {
              planning_rounds: 1,
              expert_count_min: 1,
              expert_count_max: 2,
              verifier_count_min: 1,
              reducer_enabled: false,
              reviewer_enabled: true,
              debugger_enabled: false,
              revise_policy: "critical_only",
              max_revise_nodes: 1,
              max_revision_per_artifact: 1,
              reasoning_effort: "medium",
              timeout_multiplier: 1,
            },
  )
}

function scaleResourceLimit(limit: ResourceLimitType, multiplier: number) {
  return ResourceLimit.parse({
    max_rounds: Math.max(1, Math.round(limit.max_rounds * multiplier)),
    max_model_calls: Math.max(1, Math.round(limit.max_model_calls * multiplier)),
    max_tool_calls: Math.max(1, Math.round(limit.max_tool_calls * multiplier)),
    max_subagents: Math.max(1, Math.round(limit.max_subagents * multiplier)),
    max_wallclock_ms: Math.max(60_000, Math.round(limit.max_wallclock_ms * multiplier)),
    max_estimated_tokens: Math.max(10_000, Math.round(limit.max_estimated_tokens * multiplier)),
  })
}

function capResourceLimit(limit: ResourceLimitType, cap: ResourceLimitType) {
  return ResourceLimit.parse({
    max_rounds: Math.min(limit.max_rounds, cap.max_rounds),
    max_model_calls: Math.min(limit.max_model_calls, cap.max_model_calls),
    max_tool_calls: Math.min(limit.max_tool_calls, cap.max_tool_calls),
    max_subagents: Math.min(limit.max_subagents, cap.max_subagents),
    max_wallclock_ms: Math.min(limit.max_wallclock_ms, cap.max_wallclock_ms),
    max_estimated_tokens: Math.min(limit.max_estimated_tokens, cap.max_estimated_tokens),
  })
}

function addResourceLimit(limit: ResourceLimitType, delta?: Partial<ResourceLimitType>) {
  return ResourceLimit.parse({
    max_rounds: Math.min(10_000, limit.max_rounds + Math.max(0, delta?.max_rounds ?? 0)),
    max_model_calls: Math.min(20_000, limit.max_model_calls + Math.max(0, delta?.max_model_calls ?? 0)),
    max_tool_calls: Math.min(100_000, limit.max_tool_calls + Math.max(0, delta?.max_tool_calls ?? 0)),
    max_subagents: Math.min(10_000, limit.max_subagents + Math.max(0, delta?.max_subagents ?? 0)),
    max_wallclock_ms: Math.min(
      14 * 24 * 60 * 60 * 1000,
      limit.max_wallclock_ms + Math.max(0, delta?.max_wallclock_ms ?? 0),
    ),
    max_estimated_tokens: Math.min(
      100_000_000,
      limit.max_estimated_tokens + Math.max(0, delta?.max_estimated_tokens ?? 0),
    ),
  })
}

function taskSizeMultiplier(size: LongTaskProfileType["task_size"]) {
  if (size === "huge") return 8
  if (size === "large") return 4
  if (size === "medium") return 2
  return 1
}

function workflowBudgetMultiplier(workflow: TaskTypeType) {
  if (workflow === "coding" || workflow === "debugging" || workflow === "research") return 1.25
  if (workflow === "data-analysis" || workflow === "environment-audit") return 1.15
  if (workflow === "personal-admin" || workflow === "file-data-organization") return 0.85
  return 1
}

function budgetScaleMultiplier(scale: BudgetScaleType) {
  if (scale === "max") return 2.5
  if (scale === "large") return 1.75
  if (scale === "small") return 0.5
  return 1
}

function absoluteBaseLimit(effort: EffortLevelType) {
  return ResourceLimit.parse(
    effort === "low"
      ? {
          max_rounds: 8,
          max_model_calls: 16,
          max_tool_calls: 80,
          max_subagents: 4,
          max_wallclock_ms: 20 * 60 * 1000,
          max_estimated_tokens: 200_000,
        }
      : effort === "high"
        ? {
            max_rounds: 20,
            max_model_calls: 48,
            max_tool_calls: 240,
            max_subagents: 12,
            max_wallclock_ms: 60 * 60 * 1000,
            max_estimated_tokens: 1_000_000,
          }
        : effort === "deep"
          ? {
              max_rounds: 30,
              max_model_calls: 60,
              max_tool_calls: 300,
              max_subagents: 12,
              max_wallclock_ms: 60 * 60 * 1000,
              max_estimated_tokens: 1_250_000,
            }
          : {
              max_rounds: 12,
              max_model_calls: 32,
              max_tool_calls: 160,
              max_subagents: 8,
              max_wallclock_ms: 45 * 60 * 1000,
              max_estimated_tokens: 500_000,
            },
  )
}

function longTaskProfileFor(input: {
  goal: string
  intent: IntentProfileType
  effort: EffortLevelType
  nodeCount: number
  workspaceSignals?: WorkspaceSignals
}) {
  const tokenEstimate = Math.ceil(input.goal.length / 4)
  const outputDimensions = input.intent.success_criteria.length + (input.goal.match(/\n|\d\.|;|,/g)?.length ?? 0)
  const workspaceScore =
    (input.workspaceSignals?.file_count ?? 0) >= 1_000
      ? 3
      : (input.workspaceSignals?.file_count ?? 0) >= 300
        ? 2
        : (input.workspaceSignals?.file_count ?? 0) >= 100
          ? 1
          : 0
  const explicitLong = isBroadAgentTask(input.goal)
  const score =
    (explicitLong ? 3 : 0) +
    (input.effort === "deep" ? 3 : input.effort === "high" ? 2 : 0) +
    (input.nodeCount >= 12 ? 3 : input.nodeCount >= 8 ? 2 : input.nodeCount >= 5 ? 1 : 0) +
    (tokenEstimate >= 300 ? 2 : tokenEstimate >= 120 ? 1 : 0) +
    (outputDimensions >= 8 ? 2 : outputDimensions >= 5 ? 1 : 0) +
    workspaceScore +
    ((input.workspaceSignals?.package_count ?? 0) >= 6
      ? 2
      : (input.workspaceSignals?.package_count ?? 0) >= 2
        ? 1
        : 0) +
    ((input.workspaceSignals?.language_count ?? 0) >= 4 ? 1 : 0)
  const task_size = score >= 10 ? "huge" : score >= 7 ? "large" : score >= 4 ? "medium" : "small"
  const is_long_task = score >= 4 || ((input.effort === "high" || input.effort === "deep") && explicitLong)
  return LongTaskProfile.parse({
    is_long_task,
    task_size,
    timeline_required: is_long_task,
    reasons: [
      explicitLong ? "broad or deep-dive goal" : undefined,
      input.effort === "high" || input.effort === "deep" ? `${input.effort} effort selected` : undefined,
      input.nodeCount >= 5 ? `coordinator plan has ${input.nodeCount} nodes` : undefined,
      tokenEstimate >= 120 ? `prompt estimate is ${tokenEstimate} tokens` : undefined,
      outputDimensions >= 5 ? `goal has ${outputDimensions} output dimensions` : undefined,
      ...(input.workspaceSignals?.reasons ?? []),
    ].filter((item): item is string => Boolean(item)),
  })
}

function taskTypeForGoal(goal: string): TaskTypeType {
  const normalized = goal.toLowerCase()
  if (hasAny(normalized, ["review", "code review", "pull request", "pr "])) return "review"
  if (hasAny(normalized, ["debug", "bug", "error", "fail", "failing", "fix"])) return "debugging"
  if (isProjectDeepDiveGoal(goal)) return "research"
  if (hasAny(normalized, ["write", "draft", "essay", "article", "copy", "story"])) return "writing"
  if (hasAny(normalized, ["data analysis", "analyze dataset", "spreadsheet", "statistics", "stats", "chart"]))
    return "data-analysis"
  if (hasAny(normalized, ["implement", "code", "refactor", "test", "typescript", "api", "frontend", "backend"]))
    return "coding"
  if (hasAny(normalized, ["plan", "roadmap", "strategy", "timeline", "milestone"])) return "planning"
  if (hasAny(normalized, ["calendar", "email", "inbox", "personal admin", "follow up", "follow-up"]))
    return "personal-admin"
  if (hasAny(normalized, ["research", "investigate", "analysis", "analyze"])) return "research"
  if (hasAny(normalized, ["doc", "readme", "documentation", "writing"])) return "documentation"
  if (hasAny(normalized, ["environment", "audit", "install", "path", "powershell", "python"]))
    return "environment-audit"
  if (hasAny(normalized, ["automation", "automate", "schedule", "cron"])) return "automation"
  if (hasAny(normalized, ["organize", "file", "data", "csv", "xlsx"])) return "file-data-organization"
  return "general-operations"
}

function riskForGoal(goal: string, taskType: TaskTypeType) {
  const normalized = goal.toLowerCase()
  if (hasAny(normalized, ["delete", "drop", "reset", "wipe", "production", "deploy", "payment", "credential"]))
    return "high"
  if (
    taskType === "coding" ||
    taskType === "debugging" ||
    taskType === "automation" ||
    taskType === "environment-audit"
  )
    return "medium"
  return "low"
}

function successCriteria(taskType: TaskTypeType) {
  if (taskType === "coding")
    return [
      "Relevant context is gathered",
      "Requested changes are implemented",
      "Acceptance checks are verified",
      "Independent review is completed",
    ]
  if (taskType === "debugging")
    return [
      "Failure context is reproduced or explained",
      "Root cause is identified",
      "Minimal fix path is applied",
      "Verification passes",
    ]
  if (taskType === "review")
    return ["Findings are grounded in source references", "Risks are prioritized", "Residual test gaps are reported"]
  if (taskType === "research")
    return ["Sources and local context are synthesized", "Actionable conclusions are written", "Claims are reviewed"]
  if (taskType === "writing")
    return ["Audience and purpose are identified", "Draft is produced", "Style and factuality are reviewed"]
  if (taskType === "data-analysis")
    return ["Data shape is profiled", "Analysis is performed", "Statistics and anomalies are verified"]
  if (taskType === "planning")
    return ["Goal is decomposed", "Constraints and alternatives are checked", "Risks are reviewed"]
  if (taskType === "personal-admin")
    return ["Work items are classified", "Priorities and schedule are proposed", "Privacy risks are reviewed"]
  if (taskType === "documentation")
    return ["Context is gathered", "Document is updated or produced", "Output is reviewed for accuracy"]
  if (taskType === "environment-audit")
    return ["Toolchain state is inspected", "Real blockers are identified", "Verification commands are reported"]
  if (taskType === "automation")
    return [
      "Repeatable workflow is identified",
      "Automation plan is generated",
      "Risk and trigger conditions are verified",
    ]
  if (taskType === "file-data-organization")
    return ["Files or data are inventoried", "Changes are scoped", "Result is verified"]
  return ["Goal is clarified enough to execute", "Work is completed", "Result is summarized"]
}

function expectedOutput(taskType: TaskTypeType) {
  if (taskType === "coding") return "code changes, verification results, and review notes"
  if (taskType === "debugging") return "root cause, fix, and verification evidence"
  if (taskType === "review") return "prioritized findings with file references and residual risks"
  if (taskType === "research") return "research report with actionable synthesis"
  if (taskType === "writing") return "structured written draft with style and factuality review"
  if (taskType === "data-analysis") return "analysis summary with data caveats, checks, and anomalies"
  if (taskType === "planning") return "execution plan with constraints, alternatives, and risks"
  if (taskType === "personal-admin") return "prioritized personal admin actions with privacy review"
  if (taskType === "documentation") return "updated documentation or a written artifact"
  if (taskType === "environment-audit") return "environment diagnosis with blockers and next actions"
  if (taskType === "automation") return "automation plan or configured automation"
  if (taskType === "file-data-organization") return "organized files/data and a change summary"
  return "completed work summary with evidence"
}

function permissionExpectations(taskType: TaskTypeType, riskLevel: IntentProfileType["risk_level"]) {
  const base =
    taskType === "research" || taskType === "review"
      ? ["read workspace context"]
      : ["read workspace context", "run verification commands"]
  const write =
    taskType === "coding" ||
    taskType === "debugging" ||
    taskType === "documentation" ||
    taskType === "file-data-organization" ||
    taskType === "writing" ||
    taskType === "data-analysis"
      ? ["write scoped workspace files"]
      : []
  const approval = riskLevel === "high" ? ["request approval before high-risk actions"] : []
  return [...base, ...write, ...approval]
}

export function settleIntentProfile(input: { goal: string }) {
  const task_type = taskTypeForGoal(input.goal)
  const risk_level = riskForGoal(input.goal, task_type)
  const needs_user_clarification = input.goal.trim().length < 12
  const projectDeepDive = isProjectDeepDiveGoal(input.goal)
  return IntentProfile.parse({
    goal: input.goal,
    task_type,
    success_criteria: successCriteria(task_type),
    risk_level,
    needs_user_clarification,
    clarification_questions: needs_user_clarification ? ["What concrete output should this task produce?"] : [],
    workflow: task_type,
    workflow_confidence: projectDeepDive ? "high" : input.goal.trim().length < 12 ? "low" : "medium",
    secondary_workflows: [],
    expected_output: expectedOutput(task_type),
    permission_expectations: permissionExpectations(task_type, risk_level),
  })
}

function node(
  input: Omit<CoordinatorNodeInput, "priority" | "origin"> & Partial<Pick<CoordinatorNodeInput, "priority" | "origin">>,
) {
  return CoordinatorNode.parse({
    priority: "normal",
    origin: "coordinator",
    ...input,
  })
}

function researcher(goal: string) {
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
}) {
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

function parallelResearchers(goal: string) {
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

function projectDeepDiveResearchers(goal: string) {
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

function researchersForGoal(goal: string) {
  if (isProjectDeepDiveGoal(goal)) return projectDeepDiveResearchers(goal)
  return parallelResearchers(goal)
}

function researchReducer(goal: string, dependsOn: string[]) {
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

function parallelResearchStage(goal: string) {
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
}) {
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

function parallelVerificationStage(goal: string, dependsOn: string[]) {
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

function expertID(workflow: TaskTypeType, role: CoordinatorNodeType["role"]) {
  return `${workflow}.${role}`.replace(/[^a-z0-9.-]/gi, "-").toLowerCase()
}

function artifactType(node: CoordinatorNodeType) {
  if (node.role === "reviser") return "revise"
  if (node.role === "reducer") return "reducer-output"
  if (node.task_kind === "verify") return "verification"
  if (node.task_kind === "implement") return "implementation"
  if (node.task_kind === "research") return "research"
  return node.output_schema
}

function withExpertHarness(
  node: CoordinatorNodeType,
  input: {
    workflow: TaskTypeType
    effort: EffortLevelType
    profile: EffortProfileType
  },
) {
  const role = node.expert_role ?? node.role
  return CoordinatorNode.parse({
    ...node,
    workflow: node.workflow ?? input.workflow,
    expert_id: node.expert_id ?? expertID(input.workflow, node.role),
    expert_role: role,
    artifact_type: node.artifact_type ?? artifactType(node),
    artifact_id: node.artifact_id ?? `${node.id}:output`,
    memory_namespace: node.memory_namespace ?? `${input.workflow}:${role}`,
    revise_policy: node.revise_policy ?? input.profile.revise_policy,
  })
}

function plannerNode(input: {
  id: string
  round: number
  goal: string
  workflow: TaskTypeType
  effort: EffortLevelType
}) {
  return node({
    id: input.id,
    description: `Planning round ${input.round}`,
    prompt: [
      `Create or refine the execution plan for this mission.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      ``,
      `Return summary, assumptions, missing context, risks, confidence, and next step.`,
    ].join("\n"),
    task_kind: "generic",
    subagent_type: "general",
    role: "planner",
    risk: "low",
    depends_on: input.round === 1 ? [] : [`planning_round_${input.round - 1}`],
    write_scope: [],
    read_scope: [],
    acceptance_checks: ["Plan refined without unsupported assumptions"],
    output_schema: "plan",
    requires_user_input: false,
    priority: "high",
    expert_id: expertID(input.workflow, "planner"),
    expert_role: "planner",
    workflow: input.workflow,
    artifact_type: "plan",
    artifact_id: `${input.id}:output`,
    memory_namespace: `${input.workflow}:planner`,
  })
}

function reviseNode(input: {
  id: string
  kind: z.infer<typeof RevisePoint>["kind"]
  target?: CoordinatorNodeType
  dependsOn: string[]
  goal: string
  workflow: TaskTypeType
  effort: EffortLevelType
  required?: boolean
}) {
  const artifactID = input.target?.artifact_id ?? `${input.target?.id ?? input.id}:artifact`
  return node({
    id: input.id,
    description: `${input.kind.replaceAll("_", " ")}${input.target ? ` for ${input.target.id}` : ""}`,
    prompt: [
      `Revise the target artifact quality without exposing chain-of-thought.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      input.target ? `Target node: ${input.target.id}` : undefined,
      `Revise kind: ${input.kind}`,
      ``,
      `Return JSON-like fields: pass, issues, missing_context, required_changes, confidence, action.`,
    ]
      .filter((item): item is string => Boolean(item))
      .join("\n"),
    task_kind: "verify",
    subagent_type: "general",
    role: "reviser",
    risk: "low",
    depends_on: input.dependsOn,
    write_scope: [],
    read_scope: input.target?.read_scope ?? [],
    acceptance_checks: ["Artifact quality checked", "Required changes or pass/fail decision returned"],
    output_schema: "revise",
    requires_user_input: false,
    priority: input.required === false ? "low" : "normal",
    expert_id: expertID(input.workflow, "reviser"),
    expert_role: "reviser",
    workflow: input.workflow,
    artifact_type: "revise",
    artifact_id: `${input.id}:output`,
    revision_of: artifactID,
    quality_gate_id: input.id,
    memory_namespace: `${input.workflow}:reviser`,
  })
}

function checkpointNode(input: {
  id: string
  goal: string
  workflow: TaskTypeType
  effort: EffortLevelType
  dependsOn: string[]
}) {
  return node({
    id: input.id,
    description: "Budget checkpoint synthesis",
    prompt: [
      `Summarize mission progress for a budget checkpoint without continuing exploration.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      ``,
      `Return completed, partial, not_started, blocked, evidence_summary, unresolved_claims, quality_summary, and suggested_continuation when more work is valuable.`,
    ].join("\n"),
    task_kind: "verify",
    subagent_type: "general",
    role: "reviewer",
    risk: "low",
    depends_on: input.dependsOn,
    write_scope: [],
    read_scope: [],
    acceptance_checks: ["Progress checkpoint produced", "Continuation recommendation includes unfinished work"],
    output_schema: "summary",
    requires_user_input: false,
    priority: "normal",
    expert_id: expertID(input.workflow, "reviewer"),
    expert_role: "checkpoint-reviewer",
    workflow: input.workflow,
    artifact_type: "summary",
    artifact_id: `${input.id}:output`,
    memory_namespace: `${input.workflow}:checkpoint`,
  })
}

function rewriteDeps(nodes: CoordinatorNodeType[], replacements: Map<string, string>) {
  return nodes.map((item) =>
    CoordinatorNode.parse({
      ...item,
      depends_on: item.depends_on.map((dependency) => replacements.get(dependency) ?? dependency),
    }),
  )
}

function sinkIDs(nodes: CoordinatorNodeType[]) {
  const dependencies = new Set(nodes.flatMap((item) => item.depends_on))
  return nodes.map((item) => item.id).filter((id) => !dependencies.has(id))
}

function lowEffortNodes(nodes: CoordinatorNodeType[]) {
  const seenGroups = new Set<string>()
  const kept = nodes
    .filter((item) => {
      if (!item.parallel_group) return true
      if (seenGroups.has(item.parallel_group)) return false
      seenGroups.add(item.parallel_group)
      return true
    })
    .filter((item) => item.role !== "reviewer" && item.role !== "reducer")
  const firstResearch = kept.find((item) => item.task_kind === "research")?.id
  const keptIDs = new Set(kept.map((item) => item.id))
  return kept.map((item) =>
    CoordinatorNode.parse({
      ...item,
      depends_on: item.depends_on.flatMap((dependency) => {
        if (keptIDs.has(dependency)) return [dependency]
        if (dependency.includes("research_synthesis") && firstResearch && firstResearch !== item.id)
          return [firstResearch]
        return []
      }),
    }),
  )
}

function todoStage(node: CoordinatorNodeType): "plan" | "research" | "expert" | "reduce" | "verify" | "final" {
  if (node.role === "planner") return "plan"
  if (node.role === "reducer") return "reduce"
  if (node.id.includes("checkpoint") || node.output_schema === "summary") return "final"
  if (node.role === "reviewer" || node.role === "reviser" || node.task_kind === "verify") return "verify"
  if (node.task_kind === "research") return "research"
  return "expert"
}

function stageTitle(stage: ReturnType<typeof todoStage>, workflow: TaskTypeType) {
  if (stage === "plan") return `Plan ${workflow} mission`
  if (stage === "research") return `Gather ${workflow} evidence`
  if (stage === "reduce") return `Synthesize expert findings`
  if (stage === "verify") return `Critically verify outputs`
  if (stage === "final") return `Summarize progress and next steps`
  return `Execute ${workflow} expert work`
}

function todoTimelineFor(input: {
  required: boolean
  nodes: CoordinatorNodeType[]
  expertLanes: Array<{ id: string; node_ids: string[] }>
  workflow: TaskTypeType
}) {
  if (!input.required) return TodoTimeline.parse({ required: false, todos: [], phases: [] })
  const stages = ["plan", "research", "expert", "reduce", "verify", "final"] as const
  const todos = stages.flatMap((stage) => {
    const stageNodes = input.nodes.filter((item) => todoStage(item) === stage)
    if (stageNodes.length === 0) return []
    const nodeIDs = stageNodes.map((item) => item.id)
    return [
      {
        id: `todo_${stage}`,
        title: stageTitle(stage, input.workflow),
        status: "pending" as const,
        priority: stage === "plan" || stage === "verify" ? ("high" as const) : ("normal" as const),
        budget_weight:
          stage === "expert" || stage === "research" ? stageNodes.length * 1.5 : Math.max(1, stageNodes.length),
        acceptance_hint: stageNodes
          .flatMap((item) => item.acceptance_checks)
          .slice(0, 3)
          .join("; "),
        depends_on: stages
          .slice(0, stages.indexOf(stage))
          .filter((candidate) => input.nodes.some((item) => todoStage(item) === candidate))
          .slice(-1)
          .map((candidate) => `todo_${candidate}`),
        assigned_stage: stage,
        node_ids: nodeIDs,
        expert_lane_ids: input.expertLanes
          .filter((lane) => lane.node_ids.some((id) => nodeIDs.includes(id)))
          .map((lane) => lane.id),
      },
    ]
  })
  return TodoTimeline.parse({
    required: true,
    todos,
    phases: todos.map((item, index) => ({
      id: `phase_${index + 1}_${item.assigned_stage}`,
      title: item.title,
      todo_ids: [item.id],
      expected_outputs: [item.acceptance_hint || item.title],
      checkpoint_after:
        item.assigned_stage === "reduce" || item.assigned_stage === "verify" || item.assigned_stage === "final",
    })),
  })
}

function budgetProfileFor(input: {
  effort: EffortLevelType
  workflow: TaskTypeType
  longTask: LongTaskProfileType
  todoTimeline: TodoTimelineType
  budget?: BudgetScaleType
  autoContinue?: AutoContinuePolicyType
  maxRounds?: number
  maxSubagents?: number
  maxWallclockMs?: number
}) {
  const scale = input.budget ?? "normal"
  const absolute = scaleResourceLimit(
    absoluteBaseLimit(input.effort),
    taskSizeMultiplier(input.longTask.task_size) *
      workflowBudgetMultiplier(input.workflow) *
      budgetScaleMultiplier(scale),
  )
  const absolute_ceiling = ResourceLimit.parse({
    ...absolute,
    max_rounds: input.maxRounds ?? absolute.max_rounds,
    max_subagents: input.maxSubagents ?? absolute.max_subagents,
    max_wallclock_ms: input.maxWallclockMs ?? absolute.max_wallclock_ms,
  })
  const mission_ceiling = scaleResourceLimit(absolute_ceiling, 0.65)
  const phase_ceiling = scaleResourceLimit(absolute_ceiling, input.longTask.is_long_task ? 0.25 : 0.5)
  const totalWeight = input.todoTimeline.todos.reduce((acc, item) => acc + item.budget_weight, 0)
  return BudgetProfile.parse({
    scale,
    auto_continue:
      input.autoContinue ?? (input.effort === "low" ? "never" : input.effort === "medium" ? "checkpoint" : "safe"),
    mission_ceiling,
    phase_ceiling,
    todo_budget: Object.fromEntries(
      input.todoTimeline.todos.map((item) => [
        item.id,
        scaleResourceLimit(mission_ceiling, totalWeight > 0 ? item.budget_weight / totalWeight : 1),
      ]),
    ),
    checkpoint_reserve: scaleResourceLimit(absolute_ceiling, input.longTask.is_long_task ? 0.08 : 0.05),
    absolute_ceiling,
    single_checkpoint_ceiling: capResourceLimit(
      absolute_ceiling,
      ResourceLimit.parse({
        max_rounds: 24,
        max_model_calls: 40,
        max_tool_calls: 240,
        max_subagents: 16,
        max_wallclock_ms: 45 * 60 * 1000,
        max_estimated_tokens: 1_000_000,
      }),
    ),
    no_progress_stop: {
      checkpoint_window: 5,
      min_new_completed_todo_weight: 0.05,
      min_new_evidence_items: 3,
      min_quality_delta: 0.03,
    },
  })
}

type BudgetOptions = {
  budget?: BudgetScaleType
  autoContinue?: AutoContinuePolicyType
  maxRounds?: number
  maxSubagents?: number
  maxWallclockMs?: number
}

function effortPlanMetadata(input: {
  nodes: CoordinatorNodeType[]
  intent: IntentProfileType
  workflow: TaskTypeType
  effort: EffortLevelType
  profile: EffortProfileType
  reviseNodes: CoordinatorNodeType[]
  budgetLimited: boolean
  budgetOptions?: BudgetOptions
  workspaceSignals?: WorkspaceSignals
}) {
  const expert_lanes = ExpertLane.array().parse(
    Object.values(
      input.nodes.reduce<
        Record<
          string,
          {
            id: string
            workflow: TaskTypeType
            role: CoordinatorNodeType["role"]
            expert_id: string
            node_ids: string[]
            memory_namespace: string
          }
        >
      >((acc, item) => {
        if (!item.expert_id || !item.expert_role) return acc
        const id = `${item.workflow ?? input.workflow}:${item.expert_id}`
        return {
          ...acc,
          [id]: {
            id,
            workflow: item.workflow ?? input.workflow,
            role: item.role,
            expert_id: item.expert_id,
            node_ids: [...(acc[id]?.node_ids ?? []), item.id],
            memory_namespace: item.memory_namespace ?? `${input.workflow}:${item.expert_role}`,
          },
        }
      }, {}),
    ),
  )
  const long_task = longTaskProfileFor({
    goal: input.intent.goal,
    intent: input.intent,
    effort: input.effort,
    nodeCount: input.nodes.length,
    workspaceSignals: input.workspaceSignals,
  })
  const todo_timeline = todoTimelineFor({
    required: long_task.timeline_required,
    nodes: input.nodes,
    expertLanes: expert_lanes,
    workflow: input.workflow,
  })
  const budget_profile = budgetProfileFor({
    effort: input.effort,
    workflow: input.workflow,
    longTask: long_task,
    todoTimeline: todo_timeline,
    ...input.budgetOptions,
  })
  const revise_points = RevisePoint.array().parse(
    input.reviseNodes.map((item) => ({
      id: item.quality_gate_id ?? item.id,
      kind: item.id.includes("input_revise")
        ? "input_revise"
        : item.id.includes("output_revise")
          ? "output_revise"
          : item.id.includes("handoff_revise")
            ? "handoff_revise"
            : item.id.includes("verifier_revise")
              ? "verifier_revise"
              : item.id.includes("reducer_revise")
                ? "reducer_revise"
                : item.id.includes("final_revise")
                  ? "final_revise"
                  : "plan_revise",
      target_node_id: typeof item.revision_of === "string" ? item.revision_of.split(":")[0] : undefined,
      artifact_id: item.revision_of,
      required: item.priority !== "low",
      node_id: item.id,
      status: "pending",
    })),
  )
  return {
    expert_lanes,
    revise_points,
    quality_gates: QualityGate.array().parse(
      revise_points.map((item) => ({
        id: item.id,
        kind: item.kind,
        node_id: item.node_id,
        artifact_id: item.artifact_id,
        status: item.status,
        required: item.required,
        issues: [],
      })),
    ),
    memory_context: {
      scopes: ["profile", "workspace"],
      workflow_tags: [`workflow:${input.workflow}`],
      expert_tags: expert_lanes.map((item) => `expert:${item.expert_id}`),
      note_ids: [],
    },
    long_task,
    todo_timeline,
    budget_profile,
    budget_state: BudgetState.parse({ budget_limited: input.budgetLimited }),
    progress_snapshot: ProgressSnapshot.parse({
      pending: todo_timeline.todos.length,
      remaining_work_score: todo_timeline.todos.length > 0 ? 1 : 0,
      evidence_coverage: 0,
      progress_score: 0,
    }),
    checkpoint_memory: CheckpointMemorySummary.parse({
      todo_state: todo_timeline.todos,
      next_recommended_todos: todo_timeline.todos.filter((item) => item.priority === "high").map((item) => item.id),
      compressed_context: long_task.timeline_required
        ? `Long task checkpoint memory initialized for ${input.workflow}/${input.effort}.`
        : "",
    }),
    budget_limited: input.budgetLimited,
  }
}

function finalizeEffortPlan(input: {
  plan: CoordinatorPlanType
  intent: IntentProfileType
  nodes: CoordinatorNodeType[]
  workflow: TaskTypeType
  effort: EffortLevelType
  profile: EffortProfileType
  reviseNodes: CoordinatorNodeType[]
  budgetLimited: boolean
  budgetOptions?: BudgetOptions
  workspaceSignals?: WorkspaceSignals
}) {
  const longTask = longTaskProfileFor({
    goal: input.plan.goal,
    intent: input.intent,
    effort: input.effort,
    nodeCount: input.nodes.length,
    workspaceSignals: input.workspaceSignals,
  })
  const nodes = longTask.timeline_required
    ? [
        ...input.nodes,
        withExpertHarness(
          checkpointNode({
            id: "budget_checkpoint_synthesis",
            goal: input.plan.goal,
            workflow: input.workflow,
            effort: input.effort,
            dependsOn: sinkIDs(input.nodes),
          }),
          { workflow: input.workflow, effort: input.effort, profile: input.profile },
        ),
      ]
    : input.nodes
  return CoordinatorPlan.parse({
    ...input.plan,
    effort: input.effort,
    workflow: input.workflow,
    effort_profile: input.profile,
    nodes,
    specialization_fallback: input.workflow === "general-operations" || input.intent.workflow_confidence === "low",
    ...effortPlanMetadata({
      nodes,
      intent: input.intent,
      workflow: input.workflow,
      effort: input.effort,
      profile: input.profile,
      reviseNodes: input.reviseNodes,
      budgetLimited: input.budgetLimited,
      budgetOptions: input.budgetOptions,
      workspaceSignals: input.workspaceSignals,
    }),
  })
}

function applyEffortGovernance(
  plan: CoordinatorPlanType,
  intent: IntentProfileType,
  effort: EffortLevelType,
  budgetOptions?: BudgetOptions,
) {
  const profile = effortProfileFor(effort)
  const workflow = intent.workflow
  const workspaceSignals = workspaceSignalsForGoal(plan.goal)
  const baseNodes = (effort === "low" ? lowEffortNodes(plan.nodes) : plan.nodes).map((item) =>
    withExpertHarness(item, { workflow, effort, profile }),
  )
  const planning =
    effort === "high" || effort === "deep"
      ? Array.from({ length: profile.planning_rounds }, (_, index) =>
          withExpertHarness(
            plannerNode({
              id: `planning_round_${index + 1}`,
              round: index + 1,
              goal: plan.goal,
              workflow,
              effort,
            }),
            { workflow, effort, profile },
          ),
        )
      : []
  const planRevise = planning.length
    ? [
        reviseNode({
          id: "plan_revise_final",
          kind: "plan_revise",
          target: planning.at(-1),
          dependsOn: [planning.at(-1)!.id],
          goal: plan.goal,
          workflow,
          effort,
        }),
      ]
    : []
  const rootGate = planRevise[0]?.id
  const gatedBase = rootGate
    ? baseNodes.map((item) =>
        item.depends_on.length === 0 ? CoordinatorNode.parse({ ...item, depends_on: [rootGate] }) : item,
      )
    : baseNodes
  const reviseNodes: CoordinatorNodeType[] = [...planRevise]
  const budgetLimited = { value: false }
  const addRevise = (item: CoordinatorNodeType) => {
    if (reviseNodes.length >= profile.max_revise_nodes) {
      budgetLimited.value = true
      return
    }
    reviseNodes.push(item)
  }

  if (effort === "high") {
    const critical = gatedBase.filter((item) => item.role === "reducer" || item.role === "verifier")
    const replacements = new Map<string, string>()
    for (const item of critical) {
      const kind = item.role === "reducer" ? "reducer_revise" : "verifier_revise"
      const id = `${item.id}_${kind}`
      addRevise(reviseNode({ id, kind, target: item, dependsOn: [item.id], goal: plan.goal, workflow, effort }))
      if (!budgetLimited.value) replacements.set(item.id, id)
    }
    const rewritten = rewriteDeps(gatedBase, replacements)
    const finalDependsOn = sinkIDs(rewritten).map((item) => replacements.get(item) ?? item)
    addRevise(
      reviseNode({
        id: "final_revise",
        kind: "final_revise",
        dependsOn: finalDependsOn,
        goal: plan.goal,
        workflow,
        effort,
      }),
    )
    const allNodes = [...planning, ...rewriteDeps(rewritten, replacements), ...reviseNodes].map((item) =>
      withExpertHarness(item, { workflow, effort, profile }),
    )
    return finalizeEffortPlan({
      plan,
      intent,
      nodes: allNodes,
      workflow,
      effort,
      profile,
      reviseNodes,
      budgetLimited: budgetLimited.value,
      budgetOptions,
      workspaceSignals,
    })
  }

  if (effort === "deep") {
    const dependents = new Set(gatedBase.flatMap((item) => item.depends_on))
    const replacements = new Map<string, string>()
    const inputReviseByNode = new Map<string, string>()
    for (const item of gatedBase) {
      if (reviseNodes.length >= profile.max_revise_nodes) {
        budgetLimited.value = true
        continue
      }
      const inputID = `${item.id}_input_revise`
      addRevise(
        reviseNode({
          id: inputID,
          kind: "input_revise",
          target: item,
          dependsOn: item.depends_on,
          goal: plan.goal,
          workflow,
          effort,
        }),
      )
      inputReviseByNode.set(item.id, inputID)
      if (reviseNodes.length >= profile.max_revise_nodes) {
        budgetLimited.value = true
        continue
      }
      const outputID = `${item.id}_output_revise`
      addRevise(
        reviseNode({
          id: outputID,
          kind: "output_revise",
          target: item,
          dependsOn: [item.id],
          goal: plan.goal,
          workflow,
          effort,
        }),
      )
      const handoffID = `${item.id}_handoff_revise`
      if (dependents.has(item.id) && reviseNodes.length < profile.max_revise_nodes) {
        addRevise(
          reviseNode({
            id: handoffID,
            kind: "handoff_revise",
            target: item,
            dependsOn: [outputID],
            goal: plan.goal,
            workflow,
            effort,
            required: false,
          }),
        )
        replacements.set(item.id, handoffID)
      } else {
        replacements.set(item.id, outputID)
      }
    }
    const rewritten = gatedBase.map((item) =>
      CoordinatorNode.parse({
        ...item,
        depends_on: inputReviseByNode.has(item.id)
          ? [inputReviseByNode.get(item.id)!]
          : item.depends_on.map((dependency) => replacements.get(dependency) ?? dependency),
      }),
    )
    addRevise(
      reviseNode({
        id: "final_revise",
        kind: "final_revise",
        dependsOn: sinkIDs(rewritten).map((item) => replacements.get(item) ?? item),
        goal: plan.goal,
        workflow,
        effort,
      }),
    )
    const rewrittenRevise = reviseNodes.map((item) => {
      const targetID = typeof item.revision_of === "string" ? item.revision_of.split(":")[0] : undefined
      return CoordinatorNode.parse({
        ...item,
        depends_on:
          item.id.endsWith("_output_revise") && targetID
            ? [targetID]
            : item.id.endsWith("_handoff_revise")
              ? item.depends_on
              : item.depends_on.map((dependency) => replacements.get(dependency) ?? dependency),
      })
    })
    const allNodes = [...planning, ...rewritten, ...rewrittenRevise].map((item) =>
      withExpertHarness(item, { workflow, effort, profile }),
    )
    return finalizeEffortPlan({
      plan,
      intent,
      nodes: allNodes,
      workflow,
      effort,
      profile,
      reviseNodes: rewrittenRevise,
      budgetLimited: budgetLimited.value,
      budgetOptions,
      workspaceSignals,
    })
  }

  if (effort === "medium") {
    addRevise(
      reviseNode({
        id: "final_revise",
        kind: "final_revise",
        dependsOn: sinkIDs(gatedBase),
        goal: plan.goal,
        workflow,
        effort,
      }),
    )
  }

  const allNodes = [...planning, ...gatedBase, ...reviseNodes].map((item) =>
    withExpertHarness(item, { workflow, effort, profile }),
  )
  return finalizeEffortPlan({
    plan,
    intent,
    nodes: allNodes,
    workflow,
    effort,
    profile,
    reviseNodes,
    budgetLimited: budgetLimited.value,
    budgetOptions,
    workspaceSignals,
  })
}

function basePlanForIntent(intent: IntentProfileType): CoordinatorPlanType {
  const goal = intent.goal
  const researchStage = parallelResearchStage(goal)
  const researchDependsOn = ["research_synthesis"]
  return CoordinatorPlan.parse({
    goal,
    nodes:
      intent.workflow === "coding"
        ? [
            ...researchStage,
            node({
              id: "implement",
              description: "Implement change",
              prompt: `Implement the requested change using the research_synthesis handoff as the primary project context.\n\nGoal: ${goal}`,
              task_kind: "implement",
              subagent_type: "general",
              role: "implementer",
              risk: intent.risk_level,
              depends_on: researchDependsOn,
              write_scope: [],
              read_scope: [],
              acceptance_checks: ["Requested change implemented"],
              output_schema: "implementation",
              requires_user_input: false,
              priority: "high",
            }),
            ...parallelVerificationStage(goal, ["implement"]),
            node({
              id: "review",
              description: "Review result",
              prompt: `Independently review the result using research_synthesis and all verifier evidence. Judge conflicts explicitly.\n\nGoal: ${goal}`,
              task_kind: "verify",
              subagent_type: "general",
              role: "reviewer",
              risk: "low",
              depends_on: ["verify_typecheck", "verify_focused_tests", "verify_acceptance"],
              write_scope: [],
              read_scope: [],
              acceptance_checks: ["Review completed"],
              output_schema: "review",
              requires_user_input: false,
            }),
          ]
        : intent.workflow === "debugging"
          ? [
              ...researchStage,
              node({
                id: "debug",
                description: "Diagnose failure",
                prompt: `Diagnose the failure and propose the smallest fix path.\n\nGoal: ${goal}`,
                task_kind: "research",
                subagent_type: "general",
                role: "debugger",
                risk: "medium",
                depends_on: researchDependsOn,
                write_scope: [],
                read_scope: [],
                acceptance_checks: ["Root cause identified"],
                output_schema: "debug",
                requires_user_input: false,
                priority: "high",
              }),
              node({
                id: "implement",
                description: "Apply minimal fix",
                prompt: `Apply the smallest safe fix for the diagnosed issue.\n\nGoal: ${goal}`,
                task_kind: "implement",
                subagent_type: "general",
                role: "implementer",
                risk: intent.risk_level,
                depends_on: ["debug"],
                write_scope: [],
                read_scope: [],
                acceptance_checks: ["Fix applied"],
                output_schema: "implementation",
                requires_user_input: false,
                priority: "high",
              }),
              ...parallelVerificationStage(goal, ["implement"]),
              node({
                id: "review",
                description: "Review fix",
                prompt: `Review the fix using debugger output, research_synthesis, and verifier evidence.\n\nGoal: ${goal}`,
                task_kind: "verify",
                subagent_type: "general",
                role: "reviewer",
                risk: "low",
                depends_on: ["verify_typecheck", "verify_focused_tests", "verify_acceptance"],
                write_scope: [],
                read_scope: [],
                acceptance_checks: ["Fix reviewed"],
                output_schema: "review",
                requires_user_input: false,
              }),
            ]
          : intent.workflow === "review"
            ? [
                researcher(goal),
                node({
                  id: "review",
                  description: "Review work",
                  prompt: `Review the requested target and return prioritized findings only when they are actionable.\n\nGoal: ${goal}`,
                  task_kind: "verify",
                  subagent_type: "general",
                  role: "reviewer",
                  risk: "low",
                  depends_on: ["research"],
                  write_scope: [],
                  read_scope: [],
                  acceptance_checks: ["Review findings are grounded in evidence"],
                  output_schema: "review",
                  requires_user_input: false,
                  priority: "high",
                }),
              ]
            : intent.workflow === "research"
              ? [
                  ...researchStage,
                  node({
                    id: "synthesize",
                    description: "Synthesize research",
                    prompt: `Synthesize research_synthesis into actionable conclusions.\n\nGoal: ${goal}`,
                    task_kind: "generic",
                    subagent_type: "general",
                    role: "writer",
                    risk: "low",
                    depends_on: researchDependsOn,
                    write_scope: [],
                    read_scope: [],
                    acceptance_checks: ["Research report produced"],
                    output_schema: "document",
                    requires_user_input: false,
                  }),
                  node({
                    id: "review",
                    description: "Review synthesis",
                    prompt: `Review the synthesis for unsupported claims and missing caveats.\n\nGoal: ${goal}`,
                    task_kind: "verify",
                    subagent_type: "general",
                    role: "reviewer",
                    risk: "low",
                    depends_on: ["synthesize"],
                    write_scope: [],
                    read_scope: [],
                    acceptance_checks: ["Synthesis reviewed"],
                    output_schema: "review",
                    requires_user_input: false,
                  }),
                ]
              : intent.workflow === "environment-audit"
                ? [
                    node({
                      id: "audit",
                      description: "Audit environment",
                      prompt: `Inspect the local environment, dependency state, and toolchain blockers.\n\nGoal: ${goal}`,
                      task_kind: "research",
                      subagent_type: "general",
                      role: "environment-auditor",
                      risk: intent.risk_level,
                      depends_on: [],
                      write_scope: [],
                      read_scope: [],
                      acceptance_checks: ["Environment blockers identified"],
                      output_schema: "environment-diagnosis",
                      requires_user_input: false,
                      priority: "high",
                    }),
                    node({
                      id: "verify",
                      description: "Verify environment findings",
                      prompt: `Verify the audit findings with concrete checks where possible.\n\nGoal: ${goal}`,
                      task_kind: "verify",
                      subagent_type: "general",
                      role: "verifier",
                      risk: "low",
                      depends_on: ["audit"],
                      write_scope: [],
                      read_scope: [],
                      acceptance_checks: ["Findings verified"],
                      output_schema: "verification",
                      requires_user_input: false,
                    }),
                    node({
                      id: "report",
                      description: "Write environment report",
                      prompt: `Write a concise environment diagnosis with blockers and next actions.\n\nGoal: ${goal}`,
                      task_kind: "generic",
                      subagent_type: "general",
                      role: "writer",
                      risk: "low",
                      depends_on: ["verify"],
                      write_scope: [],
                      read_scope: [],
                      acceptance_checks: ["Diagnosis report produced"],
                      output_schema: "document",
                      requires_user_input: false,
                    }),
                  ]
                : intent.workflow === "writing"
                  ? [
                      node({
                        id: "outline",
                        description: "Plan writing structure",
                        prompt: `Create a concise outline with audience, purpose, claims, and constraints.\n\nGoal: ${goal}`,
                        task_kind: "research",
                        subagent_type: "general",
                        role: "planner",
                        risk: "low",
                        depends_on: [],
                        write_scope: [],
                        read_scope: [],
                        acceptance_checks: ["Audience and structure identified"],
                        output_schema: "outline",
                        requires_user_input: false,
                        priority: "high",
                      }),
                      node({
                        id: "draft",
                        description: "Write draft",
                        prompt: `Write the requested artifact from the outline. Preserve caveats and user constraints.\n\nGoal: ${goal}`,
                        task_kind: "generic",
                        subagent_type: "general",
                        role: "writer",
                        risk: intent.risk_level,
                        depends_on: ["outline"],
                        write_scope: [],
                        read_scope: [],
                        acceptance_checks: ["Draft produced"],
                        output_schema: "draft",
                        requires_user_input: false,
                      }),
                      node({
                        id: "style_review",
                        description: "Review style and factuality",
                        prompt: `Review the draft for style fit, unsupported claims, and missing caveats.\n\nGoal: ${goal}`,
                        task_kind: "verify",
                        subagent_type: "general",
                        role: "style-editor",
                        risk: "low",
                        depends_on: ["draft"],
                        write_scope: [],
                        read_scope: [],
                        acceptance_checks: ["Style and factuality reviewed"],
                        output_schema: "review",
                        requires_user_input: false,
                      }),
                    ]
                  : intent.workflow === "data-analysis"
                    ? [
                        node({
                          id: "profile_data",
                          description: "Profile data shape",
                          prompt: `Inspect the available data shape, schema, quality limits, and analysis constraints.\n\nGoal: ${goal}`,
                          task_kind: "research",
                          subagent_type: "general",
                          role: "analyst",
                          risk: "low",
                          depends_on: [],
                          write_scope: [],
                          read_scope: [],
                          acceptance_checks: ["Data schema and limits profiled"],
                          output_schema: "analysis",
                          requires_user_input: false,
                          priority: "high",
                        }),
                        node({
                          id: "analyze_data",
                          description: "Analyze data",
                          prompt: `Run the requested analysis using the profiled constraints and report caveats.\n\nGoal: ${goal}`,
                          task_kind: "generic",
                          subagent_type: "general",
                          role: "analyst",
                          risk: intent.risk_level,
                          depends_on: ["profile_data"],
                          write_scope: [],
                          read_scope: [],
                          acceptance_checks: ["Analysis completed with caveats"],
                          output_schema: "analysis",
                          requires_user_input: false,
                        }),
                        node({
                          id: "verify_stats",
                          description: "Verify statistics and anomalies",
                          prompt: `Verify calculations, statistical assumptions, anomaly handling, and unsupported conclusions.\n\nGoal: ${goal}`,
                          task_kind: "verify",
                          subagent_type: "general",
                          role: "verifier",
                          risk: "low",
                          depends_on: ["analyze_data"],
                          write_scope: [],
                          read_scope: [],
                          acceptance_checks: ["Statistics and anomalies verified"],
                          output_schema: "verification",
                          requires_user_input: false,
                        }),
                      ]
                    : intent.workflow === "planning"
                      ? [
                          node({
                            id: "decompose_goal",
                            description: "Decompose goal",
                            prompt: `Break down the goal into milestones, dependencies, risks, and decision points.\n\nGoal: ${goal}`,
                            task_kind: "generic",
                            subagent_type: "general",
                            role: "planner",
                            risk: "low",
                            depends_on: [],
                            write_scope: [],
                            read_scope: [],
                            acceptance_checks: ["Goal decomposed into actionable plan"],
                            output_schema: "plan",
                            requires_user_input: false,
                            priority: "high",
                          }),
                          node({
                            id: "check_constraints",
                            description: "Check constraints and alternatives",
                            prompt: `Check constraints, assumptions, alternatives, and failure modes in the plan.\n\nGoal: ${goal}`,
                            task_kind: "verify",
                            subagent_type: "general",
                            role: "constraint-checker",
                            risk: "low",
                            depends_on: ["decompose_goal"],
                            write_scope: [],
                            read_scope: [],
                            acceptance_checks: ["Constraints and alternatives checked"],
                            output_schema: "review",
                            requires_user_input: false,
                          }),
                          node({
                            id: "risk_review",
                            description: "Review plan risks",
                            prompt: `Review the plan for risk, sequencing, missing owners, and unclear acceptance criteria.\n\nGoal: ${goal}`,
                            task_kind: "verify",
                            subagent_type: "general",
                            role: "risk-reviewer",
                            risk: "low",
                            depends_on: ["check_constraints"],
                            write_scope: [],
                            read_scope: [],
                            acceptance_checks: ["Plan risks reviewed"],
                            output_schema: "review",
                            requires_user_input: false,
                          }),
                        ]
                      : intent.workflow === "personal-admin"
                        ? [
                            node({
                              id: "classify_inbox",
                              description: "Classify personal admin work",
                              prompt: `Classify the requested personal admin work into actions, priorities, and privacy constraints.\n\nGoal: ${goal}`,
                              task_kind: "research",
                              subagent_type: "general",
                              role: "inbox-classifier",
                              risk: "low",
                              depends_on: [],
                              write_scope: [],
                              read_scope: [],
                              acceptance_checks: ["Admin work classified"],
                              output_schema: "summary",
                              requires_user_input: false,
                              priority: "high",
                            }),
                            node({
                              id: "schedule_actions",
                              description: "Prioritize and schedule actions",
                              prompt: `Prioritize the actions and propose a safe schedule with follow-up points.\n\nGoal: ${goal}`,
                              task_kind: "generic",
                              subagent_type: "general",
                              role: "scheduler",
                              risk: intent.risk_level,
                              depends_on: ["classify_inbox"],
                              write_scope: [],
                              read_scope: [],
                              acceptance_checks: ["Actions prioritized and scheduled"],
                              output_schema: "plan",
                              requires_user_input: false,
                            }),
                            node({
                              id: "privacy_review",
                              description: "Review privacy risk",
                              prompt: `Review the proposed personal admin actions for privacy, overreach, and missing user approval.\n\nGoal: ${goal}`,
                              task_kind: "verify",
                              subagent_type: "general",
                              role: "privacy-reviewer",
                              risk: "low",
                              depends_on: ["schedule_actions"],
                              write_scope: [],
                              read_scope: [],
                              acceptance_checks: ["Privacy risk reviewed"],
                              output_schema: "review",
                              requires_user_input: false,
                            }),
                          ]
                        : intent.workflow === "documentation"
                          ? [
                              researcher(goal),
                              node({
                                id: "write",
                                description: "Write documentation",
                                prompt: `Write or update the requested documentation.\n\nGoal: ${goal}`,
                                task_kind: "implement",
                                subagent_type: "general",
                                role: "writer",
                                risk: intent.risk_level,
                                depends_on: ["research"],
                                write_scope: [],
                                read_scope: [],
                                acceptance_checks: ["Documentation produced"],
                                output_schema: "document",
                                requires_user_input: false,
                              }),
                              node({
                                id: "review",
                                description: "Review documentation",
                                prompt: `Review the documentation for accuracy and missing caveats.\n\nGoal: ${goal}`,
                                task_kind: "verify",
                                subagent_type: "general",
                                role: "reviewer",
                                risk: "low",
                                depends_on: ["write"],
                                write_scope: [],
                                read_scope: [],
                                acceptance_checks: ["Documentation reviewed"],
                                output_schema: "review",
                                requires_user_input: false,
                              }),
                            ]
                          : intent.workflow === "automation"
                            ? [
                                researcher(goal),
                                node({
                                  id: "automation_plan",
                                  description: "Plan automation",
                                  prompt: `Turn the repeatable work into an automation plan with trigger, scope, and safety checks.\n\nGoal: ${goal}`,
                                  task_kind: "generic",
                                  subagent_type: "general",
                                  role: "automation-planner",
                                  risk: intent.risk_level,
                                  depends_on: ["research"],
                                  write_scope: [],
                                  read_scope: [],
                                  acceptance_checks: ["Automation plan produced"],
                                  output_schema: "automation-plan",
                                  requires_user_input: intent.risk_level === "high",
                                }),
                                node({
                                  id: "verify",
                                  description: "Verify automation plan",
                                  prompt: `Verify the automation plan for safety, permissions, and failure modes.\n\nGoal: ${goal}`,
                                  task_kind: "verify",
                                  subagent_type: "general",
                                  role: "verifier",
                                  risk: "low",
                                  depends_on: ["automation_plan"],
                                  write_scope: [],
                                  read_scope: [],
                                  acceptance_checks: ["Automation safety reviewed"],
                                  output_schema: "verification",
                                  requires_user_input: false,
                                }),
                              ]
                            : [
                                researcher(goal),
                                node({
                                  id: "execute",
                                  description: "Execute general task",
                                  prompt: `Complete the requested work and produce the expected output.\n\nGoal: ${goal}`,
                                  task_kind: "generic",
                                  subagent_type: "general",
                                  role: intent.workflow === "file-data-organization" ? "implementer" : "writer",
                                  risk: intent.risk_level,
                                  depends_on: ["research"],
                                  write_scope: [],
                                  read_scope: [],
                                  acceptance_checks: ["Requested work completed"],
                                  output_schema: "summary",
                                  requires_user_input: intent.risk_level === "high",
                                }),
                                node({
                                  id: "review",
                                  description: "Review result",
                                  prompt: `Review the result against the goal and report residual risks.\n\nGoal: ${goal}`,
                                  task_kind: "verify",
                                  subagent_type: "general",
                                  role: "reviewer",
                                  risk: "low",
                                  depends_on: ["execute"],
                                  write_scope: [],
                                  read_scope: [],
                                  acceptance_checks: ["Result reviewed"],
                                  output_schema: "review",
                                  requires_user_input: false,
                                }),
                              ],
  })
}

export function defaultPlanForIntent(
  intent: IntentProfileType,
  input?: { effort?: EffortLevelType; workflow?: TaskTypeType } & BudgetOptions,
): CoordinatorPlanType {
  const workflow = input?.workflow ?? intent.workflow
  const effort = input?.effort ?? "medium"
  const effectiveIntent = IntentProfile.parse({
    ...intent,
    workflow,
    task_type: workflow,
  })
  return applyEffortGovernance(basePlanForIntent(effectiveIntent), effectiveIntent, effort, input)
}

function expandVerifyNodes(plan: CoordinatorPlanType) {
  const seen = new Set(plan.nodes.map((item) => item.id))
  const generated = plan.nodes.flatMap((item) => {
    if (item.task_kind !== "implement") return []
    if (plan.nodes.some((node) => node.task_kind === "verify" && node.depends_on.includes(item.id))) return []
    const id = `${item.id}_verify`
    if (seen.has(id)) return []
    seen.add(id)
    return [
      CoordinatorNode.parse({
        id,
        description: `Verify ${item.description}`,
        prompt: `Verify the implementation and report remaining issues.\n\nAcceptance checks:\n${item.acceptance_checks.join("\n")}`,
        task_kind: "verify",
        subagent_type: "general",
        role: "verifier",
        risk: "low",
        depends_on: [item.id],
        write_scope: [],
        read_scope: [...item.write_scope],
        acceptance_checks: item.acceptance_checks.length > 0 ? item.acceptance_checks : ["Verification completed"],
        output_schema: "verification",
        requires_user_input: false,
        priority: item.priority,
        origin: "coordinator",
      }),
    ]
  })
  return CoordinatorPlan.parse({
    ...plan,
    nodes: [...plan.nodes, ...generated],
  })
}

function validatePlan(plan: CoordinatorPlanType) {
  const duplicate = plan.nodes.map((item) => item.id).find((id, index, ids) => ids.indexOf(id) !== index)
  if (duplicate) throw new Error(`Coordinator plan contains duplicate node id: ${duplicate}`)
  const nodes = new Map(plan.nodes.map((item) => [item.id, item]))
  for (const node of plan.nodes) {
    for (const dep of node.depends_on) {
      if (!nodes.has(dep)) throw new Error(`Coordinator dependency missing: ${node.id} depends on unknown node ${dep}`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`Coordinator plan contains a cycle at node ${id}`)
    visiting.add(id)
    for (const dep of nodes.get(id)?.depends_on ?? []) walk(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of nodes.keys()) walk(id)
}

function orderPlan(plan: CoordinatorPlanType) {
  const nodes = new Map(plan.nodes.map((item) => [item.id, item]))
  const ordered: CoordinatorNodeType[] = []
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    for (const dependency of nodes.get(id)?.depends_on ?? []) visit(dependency)
    const node = nodes.get(id)
    if (node) ordered.push(node)
  }
  for (const node of plan.nodes) visit(node.id)
  return CoordinatorPlan.parse({
    ...plan,
    nodes: ordered,
  })
}

function runFromRow(row: typeof CoordinatorRunTable.$inferSelect) {
  const intent = IntentProfile.safeParse(row.intent)
  const mode = CoordinatorMode.safeParse(row.mode)
  const workflow = TaskType.safeParse(row.workflow)
  const plan = CoordinatorPlan.parse(row.plan)
  const fallback = settleIntentProfile({ goal: row.goal })
  return CoordinatorRun.parse({
    id: row.id,
    sessionID: row.session_id,
    goal: row.goal,
    intent: intent.success ? intent.data : fallback,
    mode: mode.success ? mode.data : "autonomous",
    workflow: workflow.success ? workflow.data : fallback.workflow,
    effort: plan.effort,
    effort_profile: plan.effort_profile,
    state: row.state,
    plan,
    task_ids: row.task_ids,
    summary: row.summary ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      finished: row.time_finished ?? undefined,
    },
  })
}

function todoStatusFromTasks(items: TaskRuntime.TaskRecord[]) {
  if (items.length === 0) return "pending" as const
  if (items.some((item) => item.status === "failed")) return "blocked" as const
  if (items.some((item) => item.status === "cancelled")) return "skipped" as const
  if (items.some((item) => item.status === "partial")) return "partial" as const
  if (items.every((item) => item.status === "completed")) return "done" as const
  if (items.some((item) => item.status === "running")) return "active" as const
  if (items.some((item) => item.status === "completed")) return "partial" as const
  return "pending" as const
}

function runtimeTodoTimeline(plan: CoordinatorPlanType, taskByNode: Map<string, TaskRuntime.TaskRecord>) {
  return TodoTimeline.parse({
    ...plan.todo_timeline,
    todos: plan.todo_timeline.todos.map((item) => ({
      ...item,
      status: todoStatusFromTasks(
        item.node_ids.flatMap((id) => {
          const task = taskByNode.get(id)
          return task ? [task] : []
        }),
      ),
    })),
  })
}

function progressSnapshotFor(input: {
  todoTimeline: TodoTimelineType
  taskList: TaskRuntime.TaskRecord[]
  qualityGates: CoordinatorPlanType["quality_gates"]
}) {
  const totalWeight = input.todoTimeline.todos.reduce((acc, item) => acc + item.budget_weight, 0)
  const doneWeight = input.todoTimeline.todos
    .filter((item) => item.status === "done")
    .reduce((acc, item) => acc + item.budget_weight, 0)
  const partialWeight = input.todoTimeline.todos
    .filter((item) => item.status === "partial" || item.status === "active")
    .reduce((acc, item) => acc + item.budget_weight * 0.5, 0)
  const failed = input.taskList.filter((item) => item.status === "failed" || item.status === "cancelled").length
  const verifierTotal = input.qualityGates.length
  const verifierPassed = input.qualityGates.filter((item) => item.status === "passed").length
  const progress_score = totalWeight > 0 ? Math.min(1, (doneWeight + partialWeight) / totalWeight) : 0
  const failure_penalty = input.taskList.length > 0 ? failed / input.taskList.length : 0
  const verifier_quality = verifierTotal > 0 ? verifierPassed / verifierTotal : progress_score
  return ProgressSnapshot.parse({
    done: input.todoTimeline.todos.filter((item) => item.status === "done").length,
    partial: input.todoTimeline.todos.filter((item) => item.status === "partial" || item.status === "active").length,
    blocked: input.todoTimeline.todos.filter((item) => item.status === "blocked").length,
    pending: input.todoTimeline.todos.filter((item) => item.status === "pending").length,
    progress_score,
    evidence_coverage: Math.min(1, progress_score + verifier_quality * 0.2),
    verifier_quality,
    tool_success_rate: Math.max(0, 1 - failure_penalty),
    remaining_work_score: Math.max(0, 1 - progress_score),
    failure_penalty,
    confidence: progress_score >= 0.8 && verifier_quality >= 0.6 ? "high" : progress_score >= 0.4 ? "medium" : "low",
  })
}

function resourceUsageFor(run: CoordinatorRunType, taskList: TaskRuntime.TaskRecord[], extraStarts = 0) {
  const started = taskList.filter((item) => item.status !== "pending")
  return ResourceLimit.parse({
    max_rounds: started.length + extraStarts,
    max_model_calls: started.length + extraStarts,
    max_tool_calls:
      taskList.reduce((acc, item) => acc + (item.usage?.toolUses ?? (item.status === "completed" ? 1 : 0)), 0) +
      extraStarts,
    max_subagents: started.length + extraStarts,
    max_wallclock_ms: Math.max(0, now() - run.time.created),
    max_estimated_tokens: taskList.reduce((acc, item) => acc + (item.usage?.totalTokens ?? 0), 0),
  })
}

function limitUsed(usage: ResourceLimitType, limit: ResourceLimitType) {
  return Math.min(
    1,
    Math.max(
      limit.max_rounds <= 0 ? (usage.max_rounds > 0 ? 1 : 0) : usage.max_rounds / limit.max_rounds,
      limit.max_model_calls <= 0 ? (usage.max_model_calls > 0 ? 1 : 0) : usage.max_model_calls / limit.max_model_calls,
      limit.max_tool_calls <= 0 ? (usage.max_tool_calls > 0 ? 1 : 0) : usage.max_tool_calls / limit.max_tool_calls,
      limit.max_subagents <= 0 ? (usage.max_subagents > 0 ? 1 : 0) : usage.max_subagents / limit.max_subagents,
      limit.max_wallclock_ms <= 0
        ? usage.max_wallclock_ms > 0
          ? 1
          : 0
        : usage.max_wallclock_ms / limit.max_wallclock_ms,
      limit.max_estimated_tokens <= 0
        ? usage.max_estimated_tokens > 0
          ? 1
          : 0
        : usage.max_estimated_tokens / limit.max_estimated_tokens,
    ),
  )
}

function subtractResourceLimit(left: ResourceLimitType, right: ResourceLimitType) {
  return ResourceLimit.parse({
    max_rounds: left.max_rounds > right.max_rounds ? left.max_rounds - right.max_rounds : left.max_rounds,
    max_model_calls:
      left.max_model_calls > right.max_model_calls ? left.max_model_calls - right.max_model_calls : left.max_model_calls,
    max_tool_calls:
      left.max_tool_calls > right.max_tool_calls ? left.max_tool_calls - right.max_tool_calls : left.max_tool_calls,
    max_subagents: left.max_subagents > right.max_subagents ? left.max_subagents - right.max_subagents : left.max_subagents,
    max_wallclock_ms:
      left.max_wallclock_ms > right.max_wallclock_ms
        ? left.max_wallclock_ms - right.max_wallclock_ms
        : left.max_wallclock_ms,
    max_estimated_tokens:
      left.max_estimated_tokens > right.max_estimated_tokens
        ? left.max_estimated_tokens - right.max_estimated_tokens
        : left.max_estimated_tokens,
  })
}

function resourceLimitSlots(usage: ResourceLimitType, limit: ResourceLimitType) {
  if (usage.max_wallclock_ms >= limit.max_wallclock_ms) return 0
  if (usage.max_estimated_tokens >= limit.max_estimated_tokens) return 0
  return Math.max(
    0,
    Math.min(
      limit.max_rounds - usage.max_rounds,
      limit.max_model_calls - usage.max_model_calls,
      limit.max_tool_calls - usage.max_tool_calls,
      limit.max_subagents - usage.max_subagents,
    ),
  )
}

function nodeIDForTask(task: TaskRuntime.TaskRecord) {
  return typeof task.metadata?.coordinator_node_id === "string" ? task.metadata.coordinator_node_id : undefined
}

function todoForNode(plan: CoordinatorPlanType, nodeID: string | undefined) {
  if (!nodeID) return
  return plan.todo_timeline.todos.find((item) => item.node_ids.includes(nodeID))
}

function todoUsageFor(run: CoordinatorRunType, taskList: TaskRuntime.TaskRecord[], todoID: string | undefined) {
  if (!todoID) return resourceUsageFor(run, taskList)
  const nodeIDs = run.plan.todo_timeline.todos.find((item) => item.id === todoID)?.node_ids ?? []
  return resourceUsageFor(
    run,
    taskList.filter((item) => {
      const nodeID = nodeIDForTask(item)
      return nodeID ? nodeIDs.includes(nodeID) : false
    }),
  )
}

function budgetStateFor(input: {
  run: CoordinatorRunType
  plan: CoordinatorPlanType
  taskList: TaskRuntime.TaskRecord[]
  progressSnapshot: ProgressSnapshotType
}) {
  const usage = resourceUsageFor(input.run, input.taskList)
  const softBudgetUsed = limitUsed(usage, input.plan.budget_profile.mission_ceiling)
  const absoluteUsed = limitUsed(usage, input.plan.budget_profile.absolute_ceiling)
  return BudgetState.parse({
    soft_budget_used: softBudgetUsed,
    absolute_ceiling_used: absoluteUsed,
    checkpoint_count: input.taskList.filter(
      (item) => item.metadata?.coordinator_node_id === "budget_checkpoint_synthesis" && item.status === "completed",
    ).length,
    budget_limited: input.plan.budget_limited || softBudgetUsed >= 1,
    ceiling_hit: absoluteUsed >= 1,
  })
}

function checkpointMemoryFor(input: {
  run: CoordinatorRunType
  todoTimeline: TodoTimelineType
  progressSnapshot: ProgressSnapshotType
}) {
  return CheckpointMemorySummary.parse({
    run_id: input.run.id,
    checkpoint_id: `checkpoint_${input.run.time.updated}`,
    todo_state: input.todoTimeline.todos,
    completed_artifacts: input.todoTimeline.todos.filter((item) => item.status === "done").map((item) => item.title),
    evidence_index: input.todoTimeline.todos
      .filter((item) => item.status === "done" || item.status === "partial" || item.status === "active")
      .map((item) => `${item.id}:${item.node_ids.join(",")}`),
    unresolved_claims: input.todoTimeline.todos
      .filter((item) => item.status === "partial" || item.status === "pending")
      .map((item) => item.title),
    blocked_reasons: input.todoTimeline.todos.filter((item) => item.status === "blocked").map((item) => item.title),
    quality_scores: {
      progress_score: input.progressSnapshot.progress_score,
      evidence_coverage: input.progressSnapshot.evidence_coverage,
      verifier_quality: input.progressSnapshot.verifier_quality,
      tool_success_rate: input.progressSnapshot.tool_success_rate,
    },
    next_recommended_todos: input.todoTimeline.todos
      .filter((item) => item.status === "pending" || item.status === "partial" || item.status === "blocked")
      .slice(0, 5)
      .map((item) => item.id),
    compressed_context: `Progress ${Math.round(input.progressSnapshot.progress_score * 100)}%, evidence ${Math.round(input.progressSnapshot.evidence_coverage * 100)}%, confidence ${input.progressSnapshot.confidence}.`,
  })
}

function continuationRequestFor(input: {
  plan: CoordinatorPlanType
  todoTimeline: TodoTimelineType
  budgetState: CoordinatorPlanType["budget_state"]
  progressSnapshot: ProgressSnapshotType
}) {
  const next = input.todoTimeline.todos
    .filter((item) => item.status === "pending" || item.status === "partial" || item.status === "blocked")
    .slice(0, 5)
  if (!input.budgetState.ceiling_hit && (!input.budgetState.budget_limited || next.length === 0)) return undefined
  return ContinuationRequest.parse({
    reason: input.budgetState.ceiling_hit
      ? "Absolute ceiling reached before all todo timeline items finished."
      : "Mission budget checkpoint reached with unfinished timeline items.",
    requested_budget_delta: scaleResourceLimit(input.plan.budget_profile.single_checkpoint_ceiling, 0.5),
    next_todos: next.map((item) => item.id),
    expected_value:
      input.progressSnapshot.progress_score >= 0.5
        ? "Continue targeted work on remaining high-value todo items using existing checkpoint memory."
        : "Continue only if the unfinished todo items are still valuable to the user.",
    requires_user_approval: input.budgetState.ceiling_hit || input.plan.budget_profile.auto_continue !== "safe",
  })
}

function messageText(message: MessageV2.WithParts) {
  return message.parts
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
}

function reviewVerdictFromText(text: string | undefined): CriticalReviewVerdictType | undefined {
  if (!text) return
  const objectMatch = text.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      const parsed = CriticalReviewVerdict.safeParse(JSON.parse(objectMatch[0]))
      if (parsed.success) return parsed.data
    } catch {
      // Fall through to the line-oriented parser below.
    }
  }
  const normalized = text.toLowerCase()
  if (hasAny(normalized, ['"verdict":"pass"', "verdict: pass", "verdict pass", '"pass":true', "pass: true"])) {
    return CriticalReviewVerdict.parse({
      verdict: "pass",
      confidence: hasAny(normalized, ["confidence: high", '"confidence":"high"']) ? "high" : "medium",
    })
  }
  if (hasAny(normalized, ["ask_user", "ask user", "needs user", "user approval"])) {
    return CriticalReviewVerdict.parse({ verdict: "ask_user", required_changes: ["User input required"] })
  }
  if (hasAny(normalized, ["stop", "do not proceed", "unsafe to proceed"])) {
    return CriticalReviewVerdict.parse({ verdict: "stop", required_changes: ["Reviewer requested stop"] })
  }
  if (hasAny(normalized, ["retry", "rerun", "try again"])) {
    return CriticalReviewVerdict.parse({ verdict: "retry", required_changes: ["Reviewer requested retry"] })
  }
  if (
    hasAny(normalized, [
      '"pass":false',
      "pass: false",
      "verdict: revise",
      '"verdict":"revise"',
      "unsupported claim",
      "missing evidence",
      "contradiction",
      "required changes",
    ])
  ) {
    return CriticalReviewVerdict.parse({ verdict: "revise", required_changes: ["Reviewer found unresolved issues"] })
  }
  return
}

function reviewFailureMessage(verdict: CriticalReviewVerdictType | undefined) {
  if (!verdict || verdict.verdict === "pass") return
  return [
    `Critical review verdict: ${verdict.verdict}`,
    verdict.unsupported_claims.length ? `unsupported claims: ${verdict.unsupported_claims.join("; ")}` : undefined,
    verdict.missing_evidence.length ? `missing evidence: ${verdict.missing_evidence.join("; ")}` : undefined,
    verdict.contradictions.length ? `contradictions: ${verdict.contradictions.join("; ")}` : undefined,
    verdict.required_changes.length ? `required changes: ${verdict.required_changes.join("; ")}` : undefined,
    verdict.confidence === "low" ? "review confidence is low" : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .join(". ")
}

function reviewVerdictForTask(task: TaskRuntime.TaskRecord) {
  if (task.metadata?.output_schema !== "revise" && task.metadata?.role !== "reviser") return
  return reviewVerdictFromText(
    (typeof task.metadata?.review_text === "string" ? task.metadata.review_text : undefined) ??
      task.result_summary ??
      task.error_summary,
  )
}

function taskByNodeFor(taskList: TaskRuntime.TaskRecord[]) {
  return new Map(
    taskList.flatMap((item) => {
      const nodeID =
        typeof item.metadata?.coordinator_node_id === "string" ? item.metadata.coordinator_node_id : undefined
      return nodeID ? [[nodeID, item] as const] : []
    }),
  )
}

function gateStatusFor(taskByNode: Map<string, TaskRuntime.TaskRecord>, nodeID?: string) {
  const task = nodeID ? taskByNode.get(nodeID) : undefined
  if (!task) return "pending" as const
  if (task.status === "completed")
    return reviewFailureMessage(reviewVerdictForTask(task)) ? ("failed" as const) : ("passed" as const)
  if (task.status === "partial") return "failed" as const
  if (task.status === "failed") return "failed" as const
  if (task.status === "cancelled") return "skipped" as const
  return task.status
}

function runtimeStateFor(run: CoordinatorRunType, taskList: TaskRuntime.TaskRecord[]) {
  const taskByNode = taskByNodeFor(taskList)
  const revise_points = run.plan.revise_points.map((item) => ({
    ...item,
    status: gateStatusFor(taskByNode, item.node_id),
  }))
  const quality_gates = run.plan.quality_gates.map((item) => ({
    ...item,
    status: gateStatusFor(taskByNode, item.node_id),
  }))
  const todo_timeline = runtimeTodoTimeline(run.plan, taskByNode)
  const progress_snapshot = progressSnapshotFor({
    todoTimeline: todo_timeline,
    taskList,
    qualityGates: quality_gates,
  })
  const budget_state = budgetStateFor({ run, plan: run.plan, taskList, progressSnapshot: progress_snapshot })
  const checkpoint_memory = checkpointMemoryFor({
    run,
    todoTimeline: todo_timeline,
    progressSnapshot: progress_snapshot,
  })
  const continuation_request = continuationRequestFor({
    plan: run.plan,
    todoTimeline: todo_timeline,
    budgetState: budget_state,
    progressSnapshot: progress_snapshot,
  })
  return {
    taskByNode,
    revise_points,
    quality_gates,
    todo_timeline,
    progress_snapshot,
    budget_state,
    checkpoint_memory,
    continuation_request,
  }
}

function planWithRuntimeState(
  plan: CoordinatorPlanType,
  runtime: Omit<ReturnType<typeof runtimeStateFor>, "taskByNode">,
) {
  return CoordinatorPlan.parse({
    ...plan,
    revise_points: runtime.revise_points,
    quality_gates: runtime.quality_gates,
    todo_timeline: runtime.todo_timeline,
    budget_state: runtime.budget_state,
    progress_snapshot: runtime.progress_snapshot,
    checkpoint_memory: runtime.checkpoint_memory,
    continuation_request: runtime.continuation_request,
    budget_limited: plan.budget_limited,
  })
}

export const Event = {
  Created: BusEvent.define("coordinator.created", CoordinatorRun),
  Updated: BusEvent.define("coordinator.updated", CoordinatorRun),
  Completed: BusEvent.define("coordinator.completed", CoordinatorRun),
}

export interface Interface {
  readonly settleIntent: (input: { goal: string }) => Effect.Effect<IntentProfileType, Error>
  readonly plan: (
    input: {
      goal: string
      nodes?: CoordinatorNodeInput[]
      intent?: IntentProfileType
      effort?: EffortLevelType
      workflow?: TaskTypeType
      parallel_policy?: Partial<ParallelExecutionPolicyType>
    } & BudgetOptions,
  ) => Effect.Effect<CoordinatorPlanType, Error>
  readonly run: (
    input: {
      sessionID: SessionID
      goal: string
      nodes?: CoordinatorNodeInput[]
      intent?: IntentProfileType
      effort?: EffortLevelType
      workflow?: TaskTypeType
      mode?: CoordinatorModeType
      approved?: boolean
      parallel_policy?: Partial<ParallelExecutionPolicyType>
    } & BudgetOptions,
  ) => Effect.Effect<CoordinatorRunType, Error>
  readonly approve: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly cancel: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly retry: (input: {
    id: CoordinatorRunIDType
    taskID?: SessionID
    nodeID?: string
  }) => Effect.Effect<CoordinatorRunType, Error>
  readonly continueRun: (input: {
    id: CoordinatorRunIDType
    budgetDelta?: Partial<ResourceLimitType>
    autoContinue?: AutoContinuePolicyType
  }) => Effect.Effect<CoordinatorRunType, Error>
  readonly get: (id: CoordinatorRunIDType) => Effect.Effect<Option.Option<CoordinatorRunType>, Error>
  readonly list: (sessionID: SessionID) => Effect.Effect<CoordinatorRunType[], Error>
  readonly dispatch: (id: CoordinatorRunIDType) => Effect.Effect<{ run: CoordinatorRunType; dispatched: number }, Error>
  readonly projection: (id: CoordinatorRunIDType) => Effect.Effect<
    {
      run: CoordinatorRunType
      tasks: TaskRuntime.TaskRecord[]
      counts: Record<"pending" | "running" | "completed" | "partial" | "failed" | "cancelled", number>
      groups: Array<{
        id: string
        node_ids: string[]
        task_ids: string[]
        status: "pending" | "running" | "completed" | "partial" | "failed" | "cancelled"
        merge_status: "none" | "waiting" | "merged" | "conflict"
        blocked_by: string[]
        conflicts: string[]
        started_at?: number
        completed_at?: number
      }>
      expert_lanes: CoordinatorPlanType["expert_lanes"]
      quality_gates: CoordinatorPlanType["quality_gates"]
      revise_points: CoordinatorPlanType["revise_points"]
      memory_context: CoordinatorPlanType["memory_context"]
      effort_profile: EffortProfileType
      long_task: LongTaskProfileType
      todo_timeline: TodoTimelineType
      budget_profile: BudgetProfileType
      budget_state: CoordinatorPlanType["budget_state"]
      progress_snapshot: ProgressSnapshotType
      checkpoint_memory: CheckpointMemorySummaryType
      continuation_request?: CoordinatorPlanType["continuation_request"]
      budget_limited: boolean
      specialization_fallback: boolean
    },
    Error
  >
  readonly resume: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly summarize: (id: CoordinatorRunIDType) => Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/Coordinator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service
    const tasks = yield* TaskRuntime.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const scope = yield* Scope.Scope

    const publish = (
      def: typeof Event.Created | typeof Event.Updated | typeof Event.Completed,
      run: CoordinatorRunType,
    ) => bus.publish(def, run)

    const settleIntent: Interface["settleIntent"] = Effect.fn("Coordinator.settleIntent")(function* (input) {
      return settleIntentProfile(input)
    })

    const plan: Interface["plan"] = Effect.fn("Coordinator.plan")(function* (input) {
      const settled = input.intent ?? settleIntentProfile({ goal: input.goal })
      const workflow = input.workflow ?? settled.workflow
      const effort = input.effort ?? "medium"
      const intent = IntentProfile.parse({
        ...settled,
        workflow,
        task_type: workflow,
      })
      const parallel_policy = ParallelExecutionPolicy.parse(input.parallel_policy ?? {})
      const base =
        input.nodes && input.nodes.length > 0
          ? CoordinatorPlan.parse({
              goal: input.goal,
              nodes: input.nodes,
              parallel_policy,
              effort,
              workflow,
              effort_profile: effortProfileFor(effort),
            })
          : CoordinatorPlan.parse({ ...basePlanForIntent(intent), parallel_policy })
      const expanded = expandVerifyNodes(base)
      const governed = applyEffortGovernance(expanded, intent, effort, input)
      yield* Effect.try({
        try: () => validatePlan(governed),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      yield* Effect.forEach(
        governed.nodes.flatMap((item) => (item.model ? [item.model] : [])),
        (model) => provider.getModel(ProviderID.make(model.providerID), ModelID.make(model.modelID)),
        { concurrency: "unbounded", discard: true },
      )
      return orderPlan(governed)
    })

    const createTaskSession = Effect.fn("Coordinator.createTaskSession")(function* (input: {
      sessionID: SessionID
      node: CoordinatorNodeType
    }) {
      const fallback = input.node.task_kind === "research" ? "explore" : "general"
      const agent = (yield* agents.get(input.node.subagent_type)) ?? (yield* agents.get(fallback))
      if (!agent) throw new Error(`Coordinator could not resolve subagent ${input.node.subagent_type}`)
      return yield* sessions.create({
        parentID: input.sessionID,
        title: `${input.node.description} (@${agent.name} subagent)`,
      })
    })

    const taskPrompt = (record: TaskRuntime.TaskRecord, dependencies: TaskRuntime.TaskRecord[]) => {
      const metadata = record.metadata ?? {}
      const promptText = typeof metadata.prompt === "string" ? metadata.prompt : record.description
      const role = typeof metadata.role === "string" ? `\n\nRole: ${metadata.role}` : ""
      const risk = typeof metadata.risk === "string" ? `\nRisk: ${metadata.risk}` : ""
      const output = typeof metadata.output_schema === "string" ? `\nOutput schema: ${metadata.output_schema}` : ""
      const workflow = typeof metadata.workflow === "string" ? `\nWorkflow: ${metadata.workflow}` : ""
      const effort = typeof metadata.effort === "string" ? `\nEffort: ${metadata.effort}` : ""
      const expert = typeof metadata.expert_id === "string" ? `\nExpert: ${metadata.expert_id}` : ""
      const memoryNamespace =
        typeof metadata.memory_namespace === "string" ? `\nMemory namespace: ${metadata.memory_namespace}` : ""
      const revisePolicy =
        typeof metadata.revise_policy === "string" ? `\nRevise policy: ${metadata.revise_policy}` : ""
      const longTask =
        isRecord(metadata.long_task) && metadata.long_task.is_long_task === true ? `\nLong task: true` : ""
      const todoTimeline =
        isRecord(metadata.todo_timeline) && Array.isArray(metadata.todo_timeline.todos)
          ? `\nTodo timeline:\n${metadata.todo_timeline.todos
              .map((item) =>
                isRecord(item) ? `- ${String(item.id)}: ${String(item.title)} [${String(item.status)}]` : undefined,
              )
              .filter((item): item is string => Boolean(item))
              .join("\n")}`
          : ""
      const parallelGroup =
        typeof metadata.parallel_group === "string" ? `\nParallel group: ${metadata.parallel_group}` : ""
      const assignedScope =
        Array.isArray(metadata.assigned_scope) && metadata.assigned_scope.length
          ? `\nAssigned scope:\n${metadata.assigned_scope.map((item) => `- ${String(item)}`).join("\n")}`
          : ""
      const excludedScope =
        Array.isArray(metadata.excluded_scope) && metadata.excluded_scope.length
          ? `\nExcluded scope:\n${metadata.excluded_scope.map((item) => `- ${String(item)}`).join("\n")}`
          : ""
      const dependencySummaries = dependencies.length
        ? `\n\nCompleted dependency handoff:\n${dependencies.map((item) => `- ${item.description}: ${item.result_summary ?? item.error_summary ?? item.status}`).join("\n")}`
        : ""
      const checks = record.acceptance_checks.length
        ? `\n\nAcceptance checks:\n${record.acceptance_checks.map((item: string) => `- ${item}`).join("\n")}`
        : ""
      return `${promptText}${role}${workflow}${effort}${expert}${risk}${output}${memoryNamespace}${revisePolicy}${longTask}${todoTimeline}${parallelGroup}${assignedScope}${excludedScope}${dependencySummaries}${checks}\n\nBefore finalizing, list assumptions, check evidence support, identify missing context, and choose proceed, retry, ask_user, or handoff. Return a concise structured result with summary, evidence, assumptions, missing_context, risks, confidence, and next_step.`
    }

    const taskModel = (metadata: Record<string, unknown>) => {
      const value = metadata.model
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
      const model = value as Record<string, unknown>
      if (typeof model.providerID !== "string" || typeof model.modelID !== "string") return undefined
      return {
        providerID: ProviderID.make(model.providerID),
        modelID: ModelID.make(model.modelID),
      }
    }

    const taskVariant = (metadata: Record<string, unknown>) => {
      const value = metadata.model
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
      const model = value as Record<string, unknown>
      return typeof model.variant === "string" ? model.variant : undefined
    }

    const relevantTasks = Effect.fn("Coordinator.relevantTasks")(function* (run: CoordinatorRunType) {
      const all = yield* tasks.list(SessionID.make(run.sessionID))
      const taskIDs = new Set(run.task_ids.map((item) => SessionID.make(item)))
      return all.filter((item) => taskIDs.has(item.task_id))
    })

    const persistRuntimeState = Effect.fn("Coordinator.persistRuntimeState")(function* (run: CoordinatorRunType) {
      const taskList = yield* relevantTasks(run)
      const runtime = runtimeStateFor(run, taskList)
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              plan: planWithRuntimeState(run.plan, runtime),
              time_updated: now(),
            })
            .where(eq(CoordinatorRunTable.id, run.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, run.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const blockRunForBudget = Effect.fn("Coordinator.blockRunForBudget")(function* (
      run: CoordinatorRunType,
      reason: "soft" | "absolute",
    ) {
      const taskList = yield* relevantTasks(run)
      const runtime = runtimeStateFor(run, taskList)
      const summary =
        reason === "absolute"
          ? "Coordinator budget absolute ceiling reached; continuation requires user approval"
          : "Coordinator mission budget reached; checkpoint or continuation is required"
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "blocked",
              summary,
              plan: planWithRuntimeState(run.plan, runtime),
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, run.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, run.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const executeTask: (record: TaskRuntime.TaskRecord) => Effect.Effect<void, Error> = Effect.fn(
      "Coordinator.executeTask",
    )(function* (record) {
      const prompt = yield* Effect.serviceOption(SessionPrompt.Service)
      const continueGroup = () =>
        record.group_id
          ? Effect.gen(function* () {
              const runOpt = yield* get(record.group_id as CoordinatorRunIDType)
              if (Option.isSome(runOpt)) yield* persistRuntimeState(runOpt.value).pipe(Effect.ignore)
              yield* dispatchReady(record.group_id as CoordinatorRunIDType).pipe(Effect.ignore)
            })
          : Effect.void
      const started = yield* tasks.tryStartPending(record.task_id, record.parent_session_id)
      if (!started) return
      if (Option.isNone(prompt)) {
        yield* tasks.fail({
          taskID: record.task_id,
          parentSessionID: record.parent_session_id,
          error: "Coordinator executor unavailable: SessionPrompt.Service is not available",
        })
        yield* continueGroup()
        return
      }
      const dependencies = (yield* tasks.list(record.parent_session_id)).filter((item) =>
        record.depends_on.includes(item.task_id),
      )
      yield* prompt.value
        .prompt({
          sessionID: record.child_session_id,
          agent: record.subagent_type,
          model: taskModel(record.metadata ?? {}),
          variant: taskVariant(record.metadata ?? {}),
          parts: [
            {
              type: "text",
              text: taskPrompt(record, dependencies),
            },
          ],
        })
        .pipe(
          Effect.tap((message: MessageV2.WithParts) =>
            Effect.gen(function* () {
              const reviewFailure = reviewFailureMessage(
                record.metadata?.output_schema === "revise" || record.metadata?.role === "reviser"
                  ? reviewVerdictFromText(messageText(message))
                  : undefined,
              )
              if (reviewFailure) {
                yield* tasks.fail({
                  taskID: record.task_id,
                  parentSessionID: record.parent_session_id,
                  error: reviewFailure,
                })
                return
              }
              yield* tasks.complete({
                taskID: record.task_id,
                parentSessionID: record.parent_session_id,
                result: message,
              })
            }),
          ),
          Effect.tapError((error) =>
            tasks.fail({
              taskID: record.task_id,
              parentSessionID: record.parent_session_id,
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return tasks.fail({
              taskID: record.task_id,
              parentSessionID: record.parent_session_id,
              error: error instanceof Error ? error.message : String(error),
            })
          }),
          Effect.tap(continueGroup),
        )
      return
    })

    const dispatchReady: Interface["dispatch"] = Effect.fn("Coordinator.dispatchReady")(function* (id) {
      const instance = yield* InstanceState.context
      const workspace = yield* InstanceState.workspaceID
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const run = runOpt.value
      if (run.state !== "active") {
        return yield* Effect.fail(new Error(`Coordinator run cannot dispatch from state: ${run.state}`))
      }
      const allTasks = yield* relevantTasks(run)
      const pending = allTasks.filter((item) => item.status === "pending")
      const ready = (yield* Effect.forEach(
        pending,
        (item) =>
          tasks
            .canRun({
              parentSessionID: SessionID.make(run.sessionID),
              task: item,
            })
            .pipe(Effect.map((allowed) => (allowed ? item : undefined))),
        {
          concurrency: "unbounded",
        },
      )).filter((item): item is TaskRuntime.TaskRecord => Boolean(item))
      const runtime = runtimeStateFor(run, allTasks)
      const checkpointReady = ready.find((item) => item.metadata?.coordinator_node_id === "budget_checkpoint_synthesis")
      const ceilingHit = runtime.budget_state.ceiling_hit
      const softBudgetHit = runtime.budget_state.soft_budget_used >= 1
      const usage = resourceUsageFor(run, allTasks)
      const normalAbsoluteLimit = subtractResourceLimit(
        run.plan.budget_profile.absolute_ceiling,
        run.plan.budget_profile.checkpoint_reserve,
      )
      const checkpointSlots = resourceLimitSlots(usage, run.plan.budget_profile.absolute_ceiling)
      if (ceilingHit || checkpointSlots === 0) {
        const blocked = yield* blockRunForBudget(run, "absolute")
        return {
          run: blocked,
          dispatched: 0,
        }
      }
      if (softBudgetHit && !checkpointReady) {
        const blocked = yield* blockRunForBudget(run, ceilingHit ? "absolute" : "soft")
        return {
          run: blocked,
          dispatched: 0,
        }
      }
      const readyCandidates = ceilingHit || softBudgetHit ? (checkpointReady ? [checkpointReady] : []) : ready
      const planOrder = new Map(run.plan.nodes.map((item, index) => [item.id, index]))
      const groupFor = (item: TaskRuntime.TaskRecord) =>
        typeof item.metadata?.parallel_group === "string" ? item.metadata.parallel_group : undefined
      const nodeFor = (item: TaskRuntime.TaskRecord) =>
        typeof item.metadata?.coordinator_node_id === "string" ? item.metadata.coordinator_node_id : ""
      const orderedReady = readyCandidates.toSorted(
        (a, b) => (planOrder.get(nodeFor(a)) ?? 0) - (planOrder.get(nodeFor(b)) ?? 0),
      )
      const running = allTasks.filter((item) => item.status === "running")
      const runningGroups = new Set(
        running.flatMap((item) => {
          const group = groupFor(item)
          return group ? [group] : []
        }),
      )
      const activeGroup = run.plan.nodes
        .map((item) => item.parallel_group)
        .find((item) => item && runningGroups.has(item))
      const firstReady = orderedReady[0]
      const targetGroup = activeGroup ?? (firstReady ? groupFor(firstReady) : undefined)
      const slots = Math.max(0, run.plan.parallel_policy.max_parallel_agents - running.length)
      const budgetSlots =
        softBudgetHit && checkpointReady
          ? Math.min(1, checkpointSlots)
          : Math.min(
              resourceLimitSlots(usage, normalAbsoluteLimit),
              resourceLimitSlots(usage, run.plan.budget_profile.mission_ceiling),
              resourceLimitSlots(usage, run.plan.budget_profile.phase_ceiling),
            )
      if (budgetSlots === 0 && orderedReady.length > 0) {
        const blocked = yield* blockRunForBudget(run, "absolute")
        return {
          run: blocked,
          dispatched: 0,
        }
      }
      const withinTodoBudget = (item: TaskRuntime.TaskRecord) => {
        if (item.metadata?.coordinator_node_id === "budget_checkpoint_synthesis") return true
        const todo = todoForNode(run.plan, nodeFor(item))
        const budget = todo ? run.plan.budget_profile.todo_budget[todo.id] : undefined
        if (!todo || !budget) return true
        return resourceLimitSlots(todoUsageFor(run, allTasks, todo.id), budget) > 0
      }
      const selected = (
        run.plan.parallel_policy.mode === "off"
          ? orderedReady.slice(0, Math.min(slots, 1))
          : targetGroup
            ? orderedReady.filter((item) => groupFor(item) === targetGroup).slice(0, slots)
            : orderedReady.slice(0, Math.min(slots, 1))
      )
        .filter(withinTodoBudget)
        .slice(0, budgetSlots)
      yield* Effect.forEach(
        selected,
        (item) => attachWith(executeTask(item), { instance, workspace }).pipe(Effect.forkIn(scope)),
        {
          concurrency: "unbounded",
        },
      )
      if (selected.length === 0) yield* summarize(id).pipe(Effect.ignore)
      return {
        run,
        dispatched: selected.length,
      }
    })

    const subscriptionStops = new Map<string, () => void>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const stop of subscriptionStops.values()) stop()
        subscriptionStops.clear()
      }),
    )

    const ensureSubscribed: () => Effect.Effect<void, Error> = Effect.fn("Coordinator.ensureSubscribed")(function* () {
      const instance = yield* InstanceState.context
      if (subscriptionStops.has(instance.directory)) return
      const workspace = yield* InstanceState.workspaceID
      const stopTaskSubscription = yield* bus.subscribeCallback(TaskRuntime.Event.Updated, (event) => {
        if (!event.properties.result.group_id) return
        const runID = event.properties.result.group_id as CoordinatorRunIDType
        void Effect.runPromise(
          attachWith(dispatchReady(runID), {
            instance,
            workspace,
          }).pipe(Effect.catchCause(() => Effect.void)),
        )
      })
      subscriptionStops.set(instance.directory, () => {
        stopTaskSubscription()
        subscriptionStops.delete(instance.directory)
      })
    })

    const run: Interface["run"] = Effect.fn("Coordinator.run")(function* (input) {
      yield* ensureSubscribed()
      const settled = input.intent ?? settleIntentProfile({ goal: input.goal })
      const workflow = input.workflow ?? settled.workflow
      const intent = IntentProfile.parse({
        ...settled,
        workflow,
        task_type: workflow,
      })
      const planned = yield* plan({
        goal: input.goal,
        nodes: input.nodes,
        intent,
        effort: input.effort,
        workflow,
        parallel_policy: input.parallel_policy,
        budget: input.budget,
        autoContinue: input.autoContinue,
        maxRounds: input.maxRounds,
        maxSubagents: input.maxSubagents,
        maxWallclockMs: input.maxWallclockMs,
      })
      const mode = input.mode ?? (intent.risk_level === "high" ? "assisted" : "autonomous")
      const state =
        input.approved || (mode === "autonomous" && !intent.needs_user_clarification && intent.risk_level !== "high")
          ? "active"
          : "awaiting_approval"
      const runID = CoordinatorRunID.ascending()
      const nodeTaskIDs = new Map<string, SessionID>()
      for (const node of planned.nodes) {
        const session = yield* createTaskSession({ sessionID: input.sessionID, node })
        nodeTaskIDs.set(node.id, session.id)
      }
      for (const node of planned.nodes) {
        const taskID = nodeTaskIDs.get(node.id)
        if (!taskID) continue
        yield* tasks.create({
          parentSessionID: input.sessionID,
          childSessionID: taskID,
          groupID: runID,
          strategy: "mixed",
          taskKind: node.task_kind,
          subagentType: node.subagent_type,
          description: node.description,
          prompt: node.prompt,
          dependsOn: node.depends_on.flatMap((item) => {
            const dependency = nodeTaskIDs.get(item)
            return dependency ? [dependency] : []
          }),
          metadata: {
            prompt: node.prompt,
            write_scope: node.write_scope,
            read_scope: node.read_scope,
            acceptance_checks: node.acceptance_checks,
            priority: node.priority,
            origin: node.origin,
            coordinator_node_id: node.id,
            coordinator_run_id: runID,
            role: node.role,
            model: node.model,
            risk: node.risk,
            parallel_group: node.parallel_group,
            assigned_scope: node.assigned_scope,
            excluded_scope: node.excluded_scope,
            merge_status: node.merge_status,
            conflicts: node.conflicts,
            output_schema: node.output_schema,
            requires_user_input: node.requires_user_input,
            effort: planned.effort,
            effort_profile: planned.effort_profile,
            long_task: planned.long_task,
            todo_timeline: planned.todo_timeline,
            budget_profile: planned.budget_profile,
            expert_id: node.expert_id,
            expert_role: node.expert_role,
            workflow: node.workflow ?? planned.workflow,
            artifact_type: node.artifact_type,
            artifact_id: node.artifact_id,
            revision_of: node.revision_of,
            quality_gate_id: node.quality_gate_id,
            memory_namespace: node.memory_namespace,
            confidence: node.confidence,
            revise_policy: node.revise_policy,
            intent,
            mode,
          },
          writeScope: node.write_scope,
          readScope: node.read_scope,
          acceptanceChecks: node.acceptance_checks,
          priority: node.priority,
          origin: node.origin,
        })
      }
      const timestamp = now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(CoordinatorRunTable)
            .values({
              id: runID,
              session_id: input.sessionID,
              goal: input.goal,
              intent,
              mode,
              workflow: intent.workflow,
              state,
              plan: planned,
              task_ids: [...nodeTaskIDs.values()],
              time_created: timestamp,
              time_updated: timestamp,
            })
            .run(),
        ),
      )
      const created = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, runID)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Created, created)
      if (created.state === "active") yield* dispatchReady(created.id)
      return created
    })

    const get: Interface["get"] = Effect.fn("Coordinator.get")(function* (id) {
      yield* ensureSubscribed()
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      )
      return row ? Option.some(runFromRow(row)) : Option.none()
    })

    const list: Interface["list"] = Effect.fn("Coordinator.list")(function* (sessionID) {
      yield* ensureSubscribed()
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(CoordinatorRunTable)
            .where(eq(CoordinatorRunTable.session_id, sessionID))
            .orderBy(desc(CoordinatorRunTable.time_created))
            .all(),
        ),
      )
      return rows.map(runFromRow)
    })

    const projection: Interface["projection"] = Effect.fn("Coordinator.projection")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const run = runOpt.value
      const taskList = yield* relevantTasks(run)
      const runtime = runtimeStateFor(run, taskList)
      const taskByNode = runtime.taskByNode
      const statusFor = (items: TaskRuntime.TaskRecord[]) => {
        if (items.some((item) => item.status === "failed")) return "failed" as const
        if (items.some((item) => item.status === "cancelled")) return "cancelled" as const
        if (items.some((item) => item.status === "partial")) return "partial" as const
        if (items.every((item) => item.status === "completed")) return "completed" as const
        if (items.some((item) => item.status === "running")) return "running" as const
        return "pending" as const
      }
      const groupIDs = [
        ...new Set(run.plan.nodes.flatMap((item) => (item.parallel_group ? [item.parallel_group] : []))),
      ]
      const groups = groupIDs.map((groupID) => {
        const nodes = run.plan.nodes.filter((item) => item.parallel_group === groupID)
        const groupTasks = nodes.flatMap((item) => {
          const task = taskByNode.get(item.id)
          return task ? [task] : []
        })
        const blocked_by = nodes.flatMap((item) =>
          item.depends_on.filter((dependency) => taskByNode.get(dependency)?.status !== "completed"),
        )
        const started = groupTasks.flatMap((item) => (item.started_at ? [item.started_at] : []))
        const finished = groupTasks.flatMap((item) => (item.finished_at ? [item.finished_at] : []))
        const reducer = run.plan.nodes.find(
          (item) =>
            item.depends_on.some((dependency) => nodes.some((node) => node.id === dependency)) &&
            item.role === "reducer",
        )
        const reducerTask = reducer ? taskByNode.get(reducer.id) : undefined
        const conflicts = nodes.flatMap((item) => item.conflicts)
        return {
          id: groupID,
          node_ids: nodes.map((item) => item.id),
          task_ids: groupTasks.map((item) => item.task_id),
          status: groupTasks.length > 0 ? statusFor(groupTasks) : ("pending" as const),
          merge_status:
            conflicts.length > 0
              ? ("conflict" as const)
              : reducerTask?.status === "completed"
                ? ("merged" as const)
                : reducer
                  ? ("waiting" as const)
                  : ("none" as const),
          blocked_by: [...new Set(blocked_by)],
          conflicts,
          started_at: started.length ? Math.min(...started) : undefined,
          completed_at:
            groupTasks.length > 0 && groupTasks.every((item) => item.finished_at) ? Math.max(...finished) : undefined,
        }
      })
      return {
        run,
        tasks: taskList,
        counts: {
          pending: taskList.filter((item) => item.status === "pending").length,
          running: taskList.filter((item) => item.status === "running").length,
          completed: taskList.filter((item) => item.status === "completed").length,
          partial: taskList.filter((item) => item.status === "partial").length,
          failed: taskList.filter((item) => item.status === "failed").length,
          cancelled: taskList.filter((item) => item.status === "cancelled").length,
        },
        groups,
        expert_lanes: run.plan.expert_lanes,
        quality_gates: runtime.quality_gates,
        revise_points: runtime.revise_points,
        memory_context: run.plan.memory_context,
        effort_profile: run.plan.effort_profile,
        long_task: run.plan.long_task,
        todo_timeline: runtime.todo_timeline,
        budget_profile: run.plan.budget_profile,
        budget_state: runtime.budget_state,
        progress_snapshot: runtime.progress_snapshot,
        checkpoint_memory: runtime.checkpoint_memory,
        continuation_request: runtime.continuation_request,
        budget_limited: runtime.budget_state.budget_limited,
        specialization_fallback: run.plan.specialization_fallback,
      }
    })

    const summarize: Interface["summarize"] = Effect.fn("Coordinator.summarize")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const info = runOpt.value
      if (info.state === "cancelled") return info.summary ?? "Run cancelled"
      const taskIDs = info.task_ids.map((item) => SessionID.make(item))
      const all = yield* tasks.list(SessionID.make(info.sessionID))
      const relevant = all.filter((item: (typeof all)[number]) => taskIDs.includes(item.task_id))
      const completed = relevant.filter((item) => item.status === "completed").length
      const partial = relevant.filter((item) => item.status === "partial").length
      const failed = relevant.filter((item) => item.status === "failed").length
      const running = relevant.filter((item) => item.status === "running").length
      const pending = relevant.filter((item) => item.status === "pending").length
      const cancelled = relevant.filter((item) => item.status === "cancelled").length
      const summary = `${completed}/${relevant.length} completed, ${partial} partial, ${running} running, ${pending} pending, ${failed} failed, ${cancelled} cancelled`
      const runtime = runtimeStateFor(info, relevant)
      const state =
        failed > 0
          ? "failed"
          : cancelled > 0 && completed + cancelled === relevant.length
            ? "cancelled"
            : completed === relevant.length && relevant.length > 0
              ? "completed"
              : running === 0 && (pending > 0 || partial > 0)
                ? "blocked"
                : "active"
      const finished = state === "completed" || state === "failed" || state === "cancelled" ? now() : null
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state,
              summary,
              plan: planWithRuntimeState(info.plan, runtime),
              time_updated: now(),
              time_finished: finished,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(state === "completed" ? Event.Completed : Event.Updated, updated)
      return summary
    })

    const activateRun = Effect.fn("Coordinator.activateRun")(function* (id: CoordinatorRunIDType) {
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      if (runOpt.value.state === "completed" || runOpt.value.state === "failed" || runOpt.value.state === "cancelled")
        return runOpt.value
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "active",
              summary: "Coordinator run active",
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const approve: Interface["approve"] = Effect.fn("Coordinator.approve")(function* (id) {
      yield* ensureSubscribed()
      const current = yield* get(id)
      if (Option.isNone(current)) throw new Error(`Coordinator run not found: ${id}`)
      if (current.value.state !== "awaiting_approval" && current.value.state !== "planned") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be approved from state: ${current.value.state}`))
      }
      const activated = yield* activateRun(id)
      if (activated.state === "active") yield* dispatchReady(id)
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      return runOpt.value
    })

    const cancel: Interface["cancel"] = Effect.fn("Coordinator.cancel")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      if (runOpt.value.state === "completed" || runOpt.value.state === "failed" || runOpt.value.state === "cancelled") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be cancelled from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const prompt = yield* Effect.serviceOption(SessionPrompt.Service)
      const timestamp = now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "cancelled",
              summary: "Coordinator run cancelled",
              time_updated: timestamp,
              time_finished: timestamp,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      yield* Effect.forEach(
        taskList.filter((item) => item.status === "pending" || item.status === "running"),
        (item) =>
          Effect.gen(function* () {
            if (item.status === "running" && Option.isSome(prompt)) {
              yield* prompt.value.cancel(item.child_session_id).pipe(Effect.ignore)
            }
            yield* tasks.cancel({
              taskID: item.task_id,
              parentSessionID: item.parent_session_id,
              reason: "Coordinator run cancelled",
            })
          }),
        {
          concurrency: "unbounded",
        },
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const retry: Interface["retry"] = Effect.fn("Coordinator.retry")(function* (input) {
      yield* ensureSubscribed()
      const runOpt = yield* get(input.id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${input.id}`)
      if (runOpt.value.state === "active" || runOpt.value.state === "awaiting_approval") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be retried from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const retryable = taskList
        .filter((item) => item.status === "failed" || item.status === "cancelled" || item.status === "partial")
        .filter((item) => {
          if (input.taskID) return item.task_id === input.taskID
          if (input.nodeID) return item.metadata?.coordinator_node_id === input.nodeID
          return true
        })
      if (retryable.length === 0) return yield* Effect.fail(new Error("No retryable coordinator tasks matched"))
      yield* Effect.forEach(
        retryable,
        (item) =>
          tasks.retry({
            taskID: item.task_id,
            parentSessionID: item.parent_session_id,
          }),
        {
          concurrency: "unbounded",
          discard: true,
        },
      )
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "active",
              summary: "Coordinator run retrying",
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, input.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, input.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      yield* dispatchReady(input.id).pipe(Effect.ignore)
      const refreshed = yield* get(input.id)
      if (Option.isNone(refreshed)) throw new Error(`Coordinator run not found: ${input.id}`)
      return refreshed.value
    })

    const continueRun: Interface["continueRun"] = Effect.fn("Coordinator.continueRun")(function* (input) {
      yield* ensureSubscribed()
      const runOpt = yield* get(input.id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${input.id}`)
      if (runOpt.value.state !== "blocked" && runOpt.value.state !== "active") {
        return yield* Effect.fail(new Error(`Coordinator run cannot continue from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const runtime = runtimeStateFor(runOpt.value, taskList)
      const requested = input.budgetDelta ?? runtime.continuation_request?.requested_budget_delta
      const delta = requested ?? scaleResourceLimit(runOpt.value.plan.budget_profile.single_checkpoint_ceiling, 0.5)
      const fullDelta = ResourceLimit.parse({
        max_rounds: delta.max_rounds ?? 0,
        max_model_calls: delta.max_model_calls ?? 0,
        max_tool_calls: delta.max_tool_calls ?? 0,
        max_subagents: delta.max_subagents ?? 0,
        max_wallclock_ms: delta.max_wallclock_ms ?? 0,
        max_estimated_tokens: delta.max_estimated_tokens ?? 0,
      })
      const budget_profile = BudgetProfile.parse({
        ...runOpt.value.plan.budget_profile,
        auto_continue: input.autoContinue ?? runOpt.value.plan.budget_profile.auto_continue,
        mission_ceiling: addResourceLimit(runOpt.value.plan.budget_profile.mission_ceiling, delta),
        absolute_ceiling: addResourceLimit(runOpt.value.plan.budget_profile.absolute_ceiling, delta),
        phase_ceiling: addResourceLimit(
          runOpt.value.plan.budget_profile.phase_ceiling,
          scaleResourceLimit(fullDelta, 0.5),
        ),
        checkpoint_reserve: addResourceLimit(
          runOpt.value.plan.budget_profile.checkpoint_reserve,
          scaleResourceLimit(fullDelta, 0.1),
        ),
      })
      const plan = CoordinatorPlan.parse({
        ...planWithRuntimeState(runOpt.value.plan, runtime),
        budget_profile,
        budget_state: BudgetState.parse({}),
        continuation_request: undefined,
      })
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "active",
              summary: "Coordinator run continued with approved budget",
              plan,
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, input.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, input.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      yield* dispatchReady(input.id).pipe(Effect.ignore)
      const refreshed = yield* get(input.id)
      if (Option.isNone(refreshed)) throw new Error(`Coordinator run not found: ${input.id}`)
      return refreshed.value
    })

    const resume: Interface["resume"] = Effect.fn("Coordinator.resume")(function* (id) {
      yield* ensureSubscribed()
      const current = yield* get(id)
      if (Option.isNone(current)) throw new Error(`Coordinator run not found: ${id}`)
      if (current.value.state !== "blocked" && current.value.state !== "active") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be resumed from state: ${current.value.state}`))
      }
      const activated = yield* activateRun(id)
      if (activated.state !== "active") return activated
      yield* dispatchReady(id).pipe(Effect.ignore)
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      return runOpt.value
    })

    return Service.of({
      settleIntent,
      plan,
      run,
      approve,
      cancel,
      retry,
      continueRun,
      get,
      list,
      dispatch: dispatchReady,
      projection,
      resume,
      summarize,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(TaskRuntime.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Provider.defaultLayer),
)

export * as Coordinator from "./coordinator"
