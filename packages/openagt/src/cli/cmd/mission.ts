import type { Argv } from "yargs"
import { EOL } from "os"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { Server } from "@/server/server"
import { Provider } from "@/provider"
import { createOpencodeClient, type OpencodeClient } from "@openagt/sdk/v2"

type MissionMode = "manual" | "assisted" | "autonomous"
type MissionFormat = "text" | "json"
type MissionAction = "approve" | "cancel" | "resume" | "retry" | "projection"
type ParallelMode = "off" | "safe" | "aggressive"
type MissionEffort = "low" | "medium" | "high" | "deep"
type MissionBudget = "small" | "normal" | "large" | "max"
type MissionAutoContinue = "never" | "checkpoint" | "safe"
type MissionWorkflow =
  | "coding"
  | "research"
  | "writing"
  | "data-analysis"
  | "planning"
  | "personal-admin"
  | "automation"
  | "documentation"
  | "environment-audit"
  | "file-data-organization"
  | "general-operations"

function parseReviewerModel(input?: string) {
  if (!input) return
  const parsed = Provider.parseModel(input)
  return {
    providerID: parsed.providerID,
    modelID: parsed.modelID,
  }
}

function parseDurationMs(input?: string | number) {
  if (input === undefined) return
  if (typeof input === "number") return input
  const normalized = input.trim().toLowerCase()
  const value = Number(normalized.replace(/[a-z]+$/, ""))
  if (!Number.isFinite(value) || value <= 0) return
  if (normalized.endsWith("ms")) return Math.round(value)
  if (normalized.endsWith("s")) return Math.round(value * 1000)
  if (normalized.endsWith("m")) return Math.round(value * 60 * 1000)
  if (normalized.endsWith("h")) return Math.round(value * 60 * 60 * 1000)
  return Math.round(value)
}

function emit(format: MissionFormat, type: string, data: Record<string, unknown>) {
  if (format === "json") {
    process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), ...data }) + EOL)
    return
  }
  if (type === "intent") {
    const intent = data.intent as {
      task_type: string
      risk_level: string
      workflow: string
      workflow_confidence?: string
      expected_output: string
      permission_expectations: string[]
      clarification_questions: string[]
    }
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Intent" + UI.Style.TEXT_NORMAL)
    UI.println(`  task: ${intent.task_type}`)
    UI.println(`  risk: ${intent.risk_level}`)
    UI.println(`  workflow: ${intent.workflow}${intent.workflow_confidence ? ` (${intent.workflow_confidence})` : ""}`)
    UI.println(`  output: ${intent.expected_output}`)
    UI.println(`  permissions: ${intent.permission_expectations.join(", ") || "none"}`)
    if (intent.clarification_questions.length > 0) {
      UI.println(`  clarification: ${intent.clarification_questions.join("; ")}`)
    }
    UI.empty()
    return
  }
  if (type === "plan") {
    const plan = data.plan as {
      nodes: Array<{
        id: string
        role: string
        description: string
        risk: string
        depends_on: string[]
        parallel_group?: string
        assigned_scope?: string[]
      }>
    }
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "DAG" + UI.Style.TEXT_NORMAL)
    for (const node of plan.nodes) {
      UI.println(
        `  ${node.id} [${node.role}/${node.risk}${node.parallel_group ? `/group:${node.parallel_group}` : ""}] ${node.description}`,
      )
      if (node.depends_on.length > 0) UI.println(`    depends on: ${node.depends_on.join(", ")}`)
      if (node.assigned_scope?.length) UI.println(`    scope: ${node.assigned_scope.join(", ")}`)
    }
    UI.empty()
    return
  }
  if (type === "run") {
    const run = data.run as { id: string; state: string; mode: string; summary?: string }
    UI.println(`Run ${run.id}: ${run.state} (${run.mode})${run.summary ? ` - ${run.summary}` : ""}`)
    return
  }
  if (type === "projection") {
    const showGroups = data.showGroups === true
    const projection = data.projection as {
      run: { id: string; state: string; summary?: string }
      counts: Record<string, number>
      effort_profile?: Record<string, unknown>
      long_task?: { is_long_task: boolean; task_size: string; timeline_required: boolean; reasons: string[] }
      todo_timeline?: { todos: Array<{ id: string; title: string; status: string }> }
      budget_state?: {
        budget_limited: boolean
        ceiling_hit: boolean
        checkpoint_count: number
        soft_budget_used: number
        absolute_ceiling_used: number
      }
      progress_snapshot?: { progress_score: number; evidence_coverage: number; confidence: string }
      continuation_request?: {
        reason: string
        next_todos: string[]
        expected_value: string
        requires_user_approval: boolean
      }
      expert_lanes?: Array<{ id: string; expert_id: string; role: string; node_ids: string[] }>
      quality_gates?: Array<{ id: string; kind: string; status: string }>
      revise_points?: Array<{ id: string; kind: string; status: string }>
      tasks: Array<{
        status: string
        description: string
        metadata?: { coordinator_node_id?: unknown; role?: unknown }
        result_summary?: string
        error_summary?: string
      }>
      groups?: Array<{
        id: string
        status: string
        merge_status: string
        node_ids: string[]
        blocked_by: string[]
        conflicts: string[]
      }>
    }
    UI.println(
      `Run ${projection.run.id}: ${projection.run.state}${projection.run.summary ? ` - ${projection.run.summary}` : ""}`,
    )
    UI.println(
      `  tasks: ${projection.counts.completed} completed, ${projection.counts.running} running, ${projection.counts.pending} pending, ${projection.counts.failed} failed, ${projection.counts.cancelled} cancelled`,
    )
    if (projection.effort_profile) {
      UI.println(
        `  effort: ${String(projection.effort_profile.revise_policy ?? "none")}, revise points ${projection.revise_points?.length ?? 0}`,
      )
    }
    if (projection.long_task?.is_long_task) {
      UI.println(
        `  long task: ${projection.long_task.task_size}, timeline ${projection.long_task.timeline_required ? "required" : "optional"}`,
      )
    }
    if (projection.progress_snapshot) {
      UI.println(
        `  progress: ${Math.round(projection.progress_snapshot.progress_score * 100)}%, evidence ${Math.round(projection.progress_snapshot.evidence_coverage * 100)}%, confidence ${projection.progress_snapshot.confidence}`,
      )
    }
    if (projection.budget_state) {
      UI.println(
        `  budget: soft ${Math.round(projection.budget_state.soft_budget_used * 100)}%, ceiling ${Math.round(projection.budget_state.absolute_ceiling_used * 100)}%, checkpoints ${projection.budget_state.checkpoint_count}`,
      )
      if (projection.budget_state.ceiling_hit) UI.println(`  ceiling hit: continuation requires approval`)
    }
    if (projection.todo_timeline?.todos.length) {
      UI.println(`  todos: ${projection.todo_timeline.todos.map((item) => `${item.id}:${item.status}`).join(", ")}`)
    }
    if (projection.continuation_request) {
      UI.println(`  continuation: ${projection.continuation_request.reason}`)
      UI.println(`    next: ${projection.continuation_request.next_todos.join(", ") || "none"}`)
    }
    if (projection.expert_lanes?.length) {
      UI.println(`  experts: ${projection.expert_lanes.map((item) => item.expert_id).join(", ")}`)
    }
    if (showGroups) {
      for (const group of projection.groups ?? []) {
        UI.println(
          `  group ${group.id}: ${group.status}, merge ${group.merge_status}, nodes ${group.node_ids.join(", ")}`,
        )
        if (group.blocked_by.length > 0) UI.println(`    blocked by: ${group.blocked_by.join(", ")}`)
        if (group.conflicts.length > 0) UI.println(`    conflicts: ${group.conflicts.join("; ")}`)
      }
    }
    for (const task of projection.tasks) {
      const node = typeof task.metadata?.coordinator_node_id === "string" ? task.metadata.coordinator_node_id : "task"
      const role = typeof task.metadata?.role === "string" ? task.metadata.role : "subagent"
      UI.println(`  - ${node} [${role}/${task.status}] ${task.description}`)
      if (task.result_summary) UI.println(`    result: ${task.result_summary}`)
      if (task.error_summary) UI.println(`    error: ${task.error_summary}`)
    }
    UI.empty()
  }
}

function terminal(state: string) {
  return state === "completed" || state === "failed" || state === "cancelled"
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function watchProjection(sdk: OpencodeClient, runID: string, format: MissionFormat, showGroups = false) {
  let last = ""
  while (true) {
    const result = await sdk.coordinator.projection({ runID }, { throwOnError: true })
    const projection = result.data
    const key = JSON.stringify({
      state: projection.run.state,
      summary: projection.run.summary,
      counts: projection.counts,
      tasks: projection.tasks.map((task) => ({
        status: task.status,
        result_summary: task.result_summary,
        error_summary: task.error_summary,
      })),
    })
    if (key !== last) {
      emit(format, "projection", { projection, showGroups })
      last = key
    }
    if (terminal(projection.run.state)) return projection
    await sleep(1000)
  }
}

async function createMission(
  sdk: OpencodeClient,
  input: {
    goal: string
    mode?: MissionMode
    reviewerModel?: string
    approve?: boolean
    watch?: boolean
    sessionID?: string
    format: MissionFormat
    parallelMode?: ParallelMode
    maxParallelAgents?: number
    showGroups?: boolean
    effort?: MissionEffort
    workflow?: MissionWorkflow
    budget?: MissionBudget
    autoContinue?: MissionAutoContinue
    maxRounds?: number
    maxSubagents?: number
    maxWallclockMs?: number
  },
) {
  const sessionID =
    input.sessionID ??
    (await sdk.session.create({ title: input.goal.slice(0, 80) || "Mission" }, { throwOnError: true })).data.id
  const intent = (await sdk.coordinator.intent.settle({ goal: input.goal }, { throwOnError: true })).data
  emit(input.format, "intent", { intent, sessionID })
  const parallel_policy = {
    mode: input.parallelMode ?? "safe",
    max_parallel_agents: input.maxParallelAgents ?? 4,
  }
  const planPayload = {
    goal: input.goal,
    intent,
    parallel_policy,
    effort: input.effort,
    workflow: input.workflow,
    budget: input.budget,
    autoContinue: input.autoContinue,
    maxRounds: input.maxRounds,
    maxSubagents: input.maxSubagents,
    maxWallclockMs: input.maxWallclockMs,
  }
  const plan = (await sdk.coordinator.plan2.generate(planPayload, { throwOnError: true })).data
  const reviewerModel = parseReviewerModel(input.reviewerModel)
  const nodes = reviewerModel
    ? plan.nodes.map((node) => (node.role === "reviewer" ? { ...node, model: reviewerModel } : node))
    : plan.nodes
  emit(input.format, "plan", { plan: { ...plan, nodes }, sessionID })
  const mode = input.mode ?? (intent.risk_level === "high" ? "assisted" : "autonomous")
  const runPayload = {
    sessionID,
    goal: input.goal,
    intent,
    nodes,
    mode,
    approved: input.approve,
    parallel_policy,
    effort: input.effort,
    workflow: input.workflow,
    budget: input.budget,
    autoContinue: input.autoContinue,
    maxRounds: input.maxRounds,
    maxSubagents: input.maxSubagents,
    maxWallclockMs: input.maxWallclockMs,
  }
  const run = (await sdk.coordinator.run(runPayload, { throwOnError: true })).data
  emit(input.format, "run", { run, sessionID })
  if ((run.state === "awaiting_approval" || mode === "manual") && !input.approve) {
    if (input.format === "text") UI.println(`Approve with: openagt mission --run ${run.id} --action approve --watch`)
    return run
  }
  if (input.watch) return await watchProjection(sdk, run.id, input.format, input.showGroups)
  return run
}

async function controlMission(
  sdk: OpencodeClient,
  input: {
    runID: string
    action: MissionAction
    watch?: boolean
    format: MissionFormat
    nodeID?: string
    taskID?: string
    showGroups?: boolean
  },
) {
  const result =
    input.action === "approve"
      ? await sdk.coordinator.approve({ runID: input.runID }, { throwOnError: true })
      : input.action === "cancel"
        ? await sdk.coordinator.cancel({ runID: input.runID }, { throwOnError: true })
        : input.action === "resume"
          ? await sdk.coordinator.resume({ runID: input.runID }, { throwOnError: true })
          : input.action === "retry"
            ? await sdk.coordinator.retry(
                { runID: input.runID, task_id: input.taskID, node_id: input.nodeID },
                { throwOnError: true },
              )
            : undefined
  if (input.action === "projection") {
    const projection = (await sdk.coordinator.projection({ runID: input.runID }, { throwOnError: true })).data
    emit(input.format, "projection", { projection, showGroups: input.showGroups })
    return projection.run
  }
  if (result) emit(input.format, "run", { run: result.data })
  if (input.watch) return await watchProjection(sdk, input.runID, input.format, input.showGroups)
  return result?.data
}

export const MissionCommand = cmd({
  command: "mission [goal..]",
  describe: "create and control agentic coordinator missions",
  builder: (yargs: Argv) =>
    yargs
      .positional("goal", {
        describe: "mission goal",
        type: "string",
        array: true,
        default: [],
      })
      .option("mode", {
        type: "string",
        choices: ["manual", "assisted", "autonomous"] as const,
        describe: "coordinator mode",
      })
      .option("reviewer-model", {
        type: "string",
        describe: "reviewer model in provider/model format",
      })
      .option("effort", {
        type: "string",
        choices: ["low", "medium", "high", "deep"] as const,
        default: "medium",
        describe: "mission governance depth and token/time budget",
      })
      .option("workflow", {
        type: "string",
        choices: [
          "coding",
          "research",
          "writing",
          "data-analysis",
          "planning",
          "personal-admin",
          "automation",
          "documentation",
          "environment-audit",
          "file-data-organization",
          "general-operations",
        ] as const,
        describe: "specialized workflow adapter",
      })
      .option("budget", {
        type: "string",
        choices: ["small", "normal", "large", "max"] as const,
        default: "normal",
        describe: "mission adaptive budget scale",
      })
      .option("auto-continue", {
        type: "string",
        choices: ["never", "checkpoint", "safe"] as const,
        default: "checkpoint",
        describe: "automatic continuation policy after budget checkpoints",
      })
      .option("max-rounds", {
        type: "number",
        describe: "override mission absolute round ceiling",
      })
      .option("max-subagents", {
        type: "number",
        describe: "override mission absolute subagent ceiling",
      })
      .option("max-wallclock", {
        type: "string",
        describe: "override mission absolute wallclock ceiling, e.g. 30m or 2h",
      })
      .option("approve", {
        type: "boolean",
        describe: "approve the generated mission immediately",
        default: false,
      })
      .option("watch", {
        type: "boolean",
        describe: "watch mission projection until a terminal state",
        default: false,
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"] as const,
        default: "text",
        describe: "output format",
      })
      .option("parallel", {
        type: "string",
        choices: ["off", "safe", "aggressive"] as const,
        default: "safe",
        describe: "parallel coordinator scheduling mode",
      })
      .option("max-parallel-agents", {
        type: "number",
        default: 4,
        describe: "maximum coordinator subagents to run concurrently",
      })
      .option("show-groups", {
        type: "boolean",
        default: false,
        describe: "show parallel groups in projection output",
      })
      .option("session", {
        type: "string",
        describe: "root session id to use",
      })
      .option("run", {
        type: "string",
        describe: "existing coordinator run id to control",
      })
      .option("action", {
        type: "string",
        choices: ["approve", "cancel", "resume", "retry", "projection"] as const,
        describe: "action for an existing run",
      })
      .option("node", {
        type: "string",
        describe: "coordinator node id for retry",
      })
      .option("task", {
        type: "string",
        describe: "task id for retry",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in",
      }),
  handler: async (args) => {
    const goal = [...args.goal, ...(args["--"] || [])].join(" ").trim()
    if (args.dir) process.chdir(args.dir)
    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        return Server.Default().app.fetch(new Request(input, init))
      }) as typeof globalThis.fetch
      const sdk = createOpencodeClient({ baseUrl: "http://openagt.internal", fetch: fetchFn })
      if (args.run) {
        await controlMission(sdk, {
          runID: args.run,
          action: (args.action ?? "projection") as MissionAction,
          watch: args.watch,
          format: args.format as MissionFormat,
          nodeID: args.node,
          taskID: args.task,
          showGroups: args["show-groups"],
        })
        return
      }
      if (!goal) {
        UI.error("You must provide a mission goal, or --run with --action")
        process.exitCode = 1
        return
      }
      await createMission(sdk, {
        goal,
        mode: args.mode as MissionMode | undefined,
        reviewerModel: args["reviewer-model"],
        approve: args.approve,
        watch: args.watch,
        sessionID: args.session,
        format: args.format as MissionFormat,
        parallelMode: args.parallel as ParallelMode,
        maxParallelAgents: args["max-parallel-agents"],
        showGroups: args["show-groups"],
        effort: args.effort as MissionEffort,
        workflow: args.workflow as MissionWorkflow | undefined,
        budget: args.budget as MissionBudget,
        autoContinue: args["auto-continue"] as MissionAutoContinue,
        maxRounds: args["max-rounds"],
        maxSubagents: args["max-subagents"],
        maxWallclockMs: parseDurationMs(args["max-wallclock"]),
      })
    })
  },
})
