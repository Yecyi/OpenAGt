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
import { CoordinatorRunTable } from "./coordinator.sql"
import {
  CoordinatorNode,
  CoordinatorPlan,
  CoordinatorRun,
  CoordinatorRunID,
  CoordinatorMode,
  IntentProfile,
  TaskType,
  type CoordinatorNode as CoordinatorNodeType,
  type CoordinatorNodeInput,
  type CoordinatorMode as CoordinatorModeType,
  type CoordinatorPlan as CoordinatorPlanType,
  type CoordinatorRun as CoordinatorRunType,
  type CoordinatorRunID as CoordinatorRunIDType,
  type IntentProfile as IntentProfileType,
  type TaskType as TaskTypeType,
} from "./schema"

function now() {
  return Date.now()
}

function hasAny(value: string, terms: string[]) {
  return terms.some((item) => value.includes(item))
}

function taskTypeForGoal(goal: string): TaskTypeType {
  const normalized = goal.toLowerCase()
  if (hasAny(normalized, ["review", "code review", "pull request", "pr "])) return "review"
  if (hasAny(normalized, ["debug", "bug", "error", "fail", "failing", "fix"])) return "debugging"
  if (hasAny(normalized, ["research", "investigate", "analysis", "analyze"])) return "research"
  if (hasAny(normalized, ["doc", "readme", "documentation", "writing"])) return "documentation"
  if (hasAny(normalized, ["environment", "audit", "install", "path", "powershell", "python"])) return "environment-audit"
  if (hasAny(normalized, ["automation", "automate", "schedule", "cron"])) return "automation"
  if (hasAny(normalized, ["organize", "file", "data", "csv", "xlsx"])) return "file-data-organization"
  if (hasAny(normalized, ["implement", "code", "refactor", "test", "typescript", "api", "frontend", "backend"])) return "coding"
  return "general-operations"
}

function riskForGoal(goal: string, taskType: TaskTypeType) {
  const normalized = goal.toLowerCase()
  if (hasAny(normalized, ["delete", "drop", "reset", "wipe", "production", "deploy", "payment", "credential"])) return "high"
  if (taskType === "coding" || taskType === "debugging" || taskType === "automation" || taskType === "environment-audit") return "medium"
  return "low"
}

function successCriteria(taskType: TaskTypeType) {
  if (taskType === "coding") return ["Relevant context is gathered", "Requested changes are implemented", "Acceptance checks are verified", "Independent review is completed"]
  if (taskType === "debugging") return ["Failure context is reproduced or explained", "Root cause is identified", "Minimal fix path is applied", "Verification passes"]
  if (taskType === "review") return ["Findings are grounded in source references", "Risks are prioritized", "Residual test gaps are reported"]
  if (taskType === "research") return ["Sources and local context are synthesized", "Actionable conclusions are written", "Claims are reviewed"]
  if (taskType === "documentation") return ["Context is gathered", "Document is updated or produced", "Output is reviewed for accuracy"]
  if (taskType === "environment-audit") return ["Toolchain state is inspected", "Real blockers are identified", "Verification commands are reported"]
  if (taskType === "automation") return ["Repeatable workflow is identified", "Automation plan is generated", "Risk and trigger conditions are verified"]
  if (taskType === "file-data-organization") return ["Files or data are inventoried", "Changes are scoped", "Result is verified"]
  return ["Goal is clarified enough to execute", "Work is completed", "Result is summarized"]
}

function expectedOutput(taskType: TaskTypeType) {
  if (taskType === "coding") return "code changes, verification results, and review notes"
  if (taskType === "debugging") return "root cause, fix, and verification evidence"
  if (taskType === "review") return "prioritized findings with file references and residual risks"
  if (taskType === "research") return "research report with actionable synthesis"
  if (taskType === "documentation") return "updated documentation or a written artifact"
  if (taskType === "environment-audit") return "environment diagnosis with blockers and next actions"
  if (taskType === "automation") return "automation plan or configured automation"
  if (taskType === "file-data-organization") return "organized files/data and a change summary"
  return "completed work summary with evidence"
}

function permissionExpectations(taskType: TaskTypeType, riskLevel: IntentProfileType["risk_level"]) {
  const base = taskType === "research" || taskType === "review" ? ["read workspace context"] : ["read workspace context", "run verification commands"]
  const write = taskType === "coding" || taskType === "debugging" || taskType === "documentation" || taskType === "file-data-organization"
    ? ["write scoped workspace files"]
    : []
  const approval = riskLevel === "high" ? ["request approval before high-risk actions"] : []
  return [...base, ...write, ...approval]
}

export function settleIntentProfile(input: { goal: string }) {
  const task_type = taskTypeForGoal(input.goal)
  const risk_level = riskForGoal(input.goal, task_type)
  const needs_user_clarification = input.goal.trim().length < 12
  return IntentProfile.parse({
    goal: input.goal,
    task_type,
    success_criteria: successCriteria(task_type),
    risk_level,
    needs_user_clarification,
    clarification_questions: needs_user_clarification
      ? ["What concrete output should this task produce?"]
      : [],
    workflow: task_type,
    expected_output: expectedOutput(task_type),
    permission_expectations: permissionExpectations(task_type, risk_level),
  })
}

function node(input: Omit<CoordinatorNodeType, "priority" | "origin"> & Partial<Pick<CoordinatorNodeType, "priority" | "origin">>) {
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

export function defaultPlanForIntent(intent: IntentProfileType): CoordinatorPlanType {
  const goal = intent.goal
  return CoordinatorPlan.parse({
    goal,
    nodes: intent.workflow === "coding" ? [
      researcher(goal),
      node({
        id: "implement",
        description: "Implement change",
        prompt: `Implement the requested change.\n\nGoal: ${goal}`,
        task_kind: "implement",
        subagent_type: "general",
        role: "implementer",
        risk: intent.risk_level,
        depends_on: ["research"],
        write_scope: [],
        read_scope: [],
        acceptance_checks: ["Requested change implemented"],
        output_schema: "implementation",
        requires_user_input: false,
        priority: "high",
      }),
      node({
        id: "verify",
        description: "Verify result",
        prompt: `Verify the completed result and summarize residual issues.\n\nGoal: ${goal}`,
        task_kind: "verify",
        subagent_type: "general",
        role: "verifier",
        risk: "low",
        depends_on: ["implement"],
        write_scope: [],
        read_scope: [],
        acceptance_checks: ["Verification completed"],
        output_schema: "verification",
        requires_user_input: false,
        priority: "normal",
      }),
      node({
        id: "review",
        description: "Review result",
        prompt: `Independently review the result for defects, missing tests, and remaining risks.\n\nGoal: ${goal}`,
        task_kind: "verify",
        subagent_type: "general",
        role: "reviewer",
        risk: "low",
        depends_on: ["verify"],
        write_scope: [],
        read_scope: [],
        acceptance_checks: ["Review completed"],
        output_schema: "review",
        requires_user_input: false,
      }),
    ] : intent.workflow === "debugging" ? [
      researcher(goal),
      node({
        id: "debug",
        description: "Diagnose failure",
        prompt: `Diagnose the failure and propose the smallest fix path.\n\nGoal: ${goal}`,
        task_kind: "research",
        subagent_type: "general",
        role: "debugger",
        risk: "medium",
        depends_on: ["research"],
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
      node({
        id: "verify",
        description: "Verify fix",
        prompt: `Verify the fix and report residual failures.\n\nGoal: ${goal}`,
        task_kind: "verify",
        subagent_type: "general",
        role: "verifier",
        risk: "low",
        depends_on: ["implement"],
        write_scope: [],
        read_scope: [],
        acceptance_checks: ["Fix verified"],
        output_schema: "verification",
        requires_user_input: false,
      }),
    ] : intent.workflow === "review" ? [
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
    ] : intent.workflow === "research" ? [
      researcher(goal),
      node({
        id: "synthesize",
        description: "Synthesize research",
        prompt: `Synthesize the research into actionable conclusions.\n\nGoal: ${goal}`,
        task_kind: "generic",
        subagent_type: "general",
        role: "writer",
        risk: "low",
        depends_on: ["research"],
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
    ] : intent.workflow === "environment-audit" ? [
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
    ] : intent.workflow === "documentation" ? [
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
    ] : intent.workflow === "automation" ? [
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
    ] : [
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
    goal: plan.goal,
    nodes: [...plan.nodes, ...generated],
  })
}

function validatePlan(plan: CoordinatorPlanType) {
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
    goal: plan.goal,
    nodes: ordered,
  })
}

function runFromRow(row: typeof CoordinatorRunTable.$inferSelect) {
  const intent = IntentProfile.safeParse(row.intent)
  const mode = CoordinatorMode.safeParse(row.mode)
  const workflow = TaskType.safeParse(row.workflow)
  const fallback = settleIntentProfile({ goal: row.goal })
  return CoordinatorRun.parse({
    id: row.id,
    sessionID: row.session_id,
    goal: row.goal,
    intent: intent.success ? intent.data : fallback,
    mode: mode.success ? mode.data : "autonomous",
    workflow: workflow.success ? workflow.data : fallback.workflow,
    state: row.state,
    plan: row.plan,
    task_ids: row.task_ids,
    summary: row.summary ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      finished: row.time_finished ?? undefined,
    },
  })
}

export const Event = {
  Created: BusEvent.define("coordinator.created", CoordinatorRun),
  Updated: BusEvent.define("coordinator.updated", CoordinatorRun),
  Completed: BusEvent.define("coordinator.completed", CoordinatorRun),
}

export interface Interface {
  readonly settleIntent: (input: { goal: string }) => Effect.Effect<IntentProfileType, Error>
  readonly plan: (input: { goal: string; nodes?: CoordinatorNodeInput[]; intent?: IntentProfileType }) => Effect.Effect<CoordinatorPlanType, Error>
  readonly run: (input: {
    sessionID: SessionID
    goal: string
    nodes?: CoordinatorNodeInput[]
    intent?: IntentProfileType
    mode?: CoordinatorModeType
    approved?: boolean
  }) => Effect.Effect<CoordinatorRunType, Error>
  readonly approve: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly cancel: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly retry: (input: { id: CoordinatorRunIDType; taskID?: SessionID; nodeID?: string }) => Effect.Effect<CoordinatorRunType, Error>
  readonly get: (id: CoordinatorRunIDType) => Effect.Effect<Option.Option<CoordinatorRunType>, Error>
  readonly list: (sessionID: SessionID) => Effect.Effect<CoordinatorRunType[], Error>
  readonly dispatch: (id: CoordinatorRunIDType) => Effect.Effect<{ run: CoordinatorRunType; dispatched: number }, Error>
  readonly projection: (id: CoordinatorRunIDType) => Effect.Effect<{
    run: CoordinatorRunType
    tasks: TaskRuntime.TaskRecord[]
    counts: Record<"pending" | "running" | "completed" | "failed" | "cancelled", number>
  }, Error>
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

    const publish = (def: typeof Event.Created | typeof Event.Updated | typeof Event.Completed, run: CoordinatorRunType) =>
      bus.publish(def, run)

    const settleIntent: Interface["settleIntent"] = Effect.fn("Coordinator.settleIntent")(function* (input) {
      return settleIntentProfile(input)
    })

    const plan: Interface["plan"] = Effect.fn("Coordinator.plan")(function* (input) {
      const intent = input.intent ?? settleIntentProfile({ goal: input.goal })
      const base = input.nodes && input.nodes.length > 0 ? CoordinatorPlan.parse({ goal: input.goal, nodes: input.nodes }) : defaultPlanForIntent(intent)
      const expanded = expandVerifyNodes(base)
      validatePlan(expanded)
      yield* Effect.forEach(
        expanded.nodes.flatMap((item) => (item.model ? [item.model] : [])),
        (model) => provider.getModel(ProviderID.make(model.providerID), ModelID.make(model.modelID)),
        { concurrency: "unbounded", discard: true },
      )
      return orderPlan(expanded)
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

    const taskPrompt = (record: TaskRuntime.TaskRecord) => {
      const metadata = record.metadata ?? {}
      const promptText = typeof metadata.prompt === "string" ? metadata.prompt : record.description
      const role = typeof metadata.role === "string" ? `\n\nRole: ${metadata.role}` : ""
      const risk = typeof metadata.risk === "string" ? `\nRisk: ${metadata.risk}` : ""
      const output = typeof metadata.output_schema === "string" ? `\nOutput schema: ${metadata.output_schema}` : ""
      const checks = record.acceptance_checks.length
        ? `\n\nAcceptance checks:\n${record.acceptance_checks.map((item: string) => `- ${item}`).join("\n")}`
        : ""
      return `${promptText}${role}${risk}${output}${checks}\n\nReturn a concise structured result that the coordinator can consume.`
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

    const executeTask: (record: TaskRuntime.TaskRecord) => Effect.Effect<void, Error> = Effect.fn("Coordinator.executeTask")(function* (record) {
      const prompt = yield* Effect.serviceOption(SessionPrompt.Service)
      const current = yield* tasks.get({
        taskID: record.task_id,
        parentSessionID: record.parent_session_id,
      })
      if (Option.isNone(prompt)) return
      if (Option.isNone(current) || current.value.status !== "pending") return
      const continueGroup = () =>
        record.group_id ? dispatchReady(record.group_id as CoordinatorRunIDType).pipe(Effect.ignore) : Effect.void
      yield* tasks.setRunning(record.task_id, record.parent_session_id)
      yield* prompt.value
        .prompt({
          sessionID: record.child_session_id,
          agent: record.subagent_type,
          model: taskModel(record.metadata ?? {}),
          variant: taskVariant(record.metadata ?? {}),
          parts: [
            {
              type: "text",
              text: taskPrompt(record),
            },
          ],
        })
        .pipe(
          Effect.tap((message: MessageV2.WithParts) =>
            tasks.complete({
              taskID: record.task_id,
              parentSessionID: record.parent_session_id,
              result: message,
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
      const pending = (yield* relevantTasks(run)).filter((item) => item.status === "pending")
      const ready = (
        yield* Effect.forEach(
          pending,
          (item) =>
            tasks.canRun({
              parentSessionID: SessionID.make(run.sessionID),
              task: item,
            }).pipe(Effect.map((allowed) => (allowed ? item : undefined))),
          {
            concurrency: "unbounded",
          },
        )
      ).filter((item): item is TaskRuntime.TaskRecord => Boolean(item))
      yield* Effect.forEach(
        ready,
        (item) => attachWith(executeTask(item), { instance, workspace }).pipe(Effect.forkIn(scope)),
        {
          concurrency: "unbounded",
          discard: true,
        },
      )
      if (ready.length === 0) yield* summarize(id).pipe(Effect.ignore)
      return {
        run,
        dispatched: ready.length,
      }
    })

    const subscriptionStops = new Map<string, () => void>()
    yield* Effect.addFinalizer(
      () =>
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
          }).pipe(
            Effect.catch(() => Effect.void),
          ),
        )
      })
      subscriptionStops.set(instance.directory, () => {
        stopTaskSubscription()
        subscriptionStops.delete(instance.directory)
      })
    })

    const run: Interface["run"] = Effect.fn("Coordinator.run")(function* (input) {
      yield* ensureSubscribed()
      const intent = input.intent ?? settleIntentProfile({ goal: input.goal })
      const planned = yield* plan({ goal: input.goal, nodes: input.nodes, intent })
      const mode = input.mode ?? (intent.risk_level === "high" ? "assisted" : "autonomous")
      const state = input.approved || (mode === "autonomous" && !intent.needs_user_clarification && intent.risk_level !== "high")
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
            output_schema: node.output_schema,
            requires_user_input: node.requires_user_input,
            intent,
            mode,
            workflow: intent.workflow,
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
          db.insert(CoordinatorRunTable)
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
      const row = yield* Effect.sync(() => Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()))
      return row ? Option.some(runFromRow(row)) : Option.none()
    })

    const list: Interface["list"] = Effect.fn("Coordinator.list")(function* (sessionID) {
      yield* ensureSubscribed()
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.session_id, sessionID)).orderBy(desc(CoordinatorRunTable.time_created)).all(),
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
      return {
        run,
        tasks: taskList,
        counts: {
          pending: taskList.filter((item) => item.status === "pending").length,
          running: taskList.filter((item) => item.status === "running").length,
          completed: taskList.filter((item) => item.status === "completed").length,
          failed: taskList.filter((item) => item.status === "failed").length,
          cancelled: taskList.filter((item) => item.status === "cancelled").length,
        },
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
      const failed = relevant.filter((item) => item.status === "failed").length
      const running = relevant.filter((item) => item.status === "running").length
      const pending = relevant.filter((item) => item.status === "pending").length
      const cancelled = relevant.filter((item) => item.status === "cancelled").length
      const summary = `${completed}/${relevant.length} completed, ${running} running, ${pending} pending, ${failed} failed, ${cancelled} cancelled`
      const state =
        failed > 0
          ? "failed"
          : cancelled > 0 && completed + cancelled === relevant.length
            ? "cancelled"
            : completed === relevant.length && relevant.length > 0
              ? "completed"
              : running === 0 && pending > 0
                ? "blocked"
                : "active"
      const finished = state === "completed" || state === "failed" || state === "cancelled" ? now() : null
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.update(CoordinatorRunTable)
            .set({
              state,
              summary,
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
      if (runOpt.value.state === "completed" || runOpt.value.state === "failed" || runOpt.value.state === "cancelled") return runOpt.value
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.update(CoordinatorRunTable)
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
          discard: true,
        },
      )
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.update(CoordinatorRunTable)
            .set({
              state: "cancelled",
              summary: "Coordinator run cancelled",
              time_updated: now(),
              time_finished: now(),
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

    const retry: Interface["retry"] = Effect.fn("Coordinator.retry")(function* (input) {
      yield* ensureSubscribed()
      const runOpt = yield* get(input.id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${input.id}`)
      if (runOpt.value.state === "active" || runOpt.value.state === "awaiting_approval") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be retried from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const retryable = taskList
        .filter((item) => item.status === "failed" || item.status === "cancelled")
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
          db.update(CoordinatorRunTable)
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
