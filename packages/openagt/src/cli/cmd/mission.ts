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

function parseReviewerModel(input?: string) {
  if (!input) return
  const parsed = Provider.parseModel(input)
  return {
    providerID: parsed.providerID,
    modelID: parsed.modelID,
  }
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
      expected_output: string
      permission_expectations: string[]
      clarification_questions: string[]
    }
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Intent" + UI.Style.TEXT_NORMAL)
    UI.println(`  task: ${intent.task_type}`)
    UI.println(`  risk: ${intent.risk_level}`)
    UI.println(`  workflow: ${intent.workflow}`)
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
      UI.println(`  ${node.id} [${node.role}/${node.risk}${node.parallel_group ? `/group:${node.parallel_group}` : ""}] ${node.description}`)
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
    UI.println(`Run ${projection.run.id}: ${projection.run.state}${projection.run.summary ? ` - ${projection.run.summary}` : ""}`)
    UI.println(
      `  tasks: ${projection.counts.completed} completed, ${projection.counts.running} running, ${projection.counts.pending} pending, ${projection.counts.failed} failed, ${projection.counts.cancelled} cancelled`,
    )
    if (showGroups) {
      for (const group of projection.groups ?? []) {
        UI.println(`  group ${group.id}: ${group.status}, merge ${group.merge_status}, nodes ${group.node_ids.join(", ")}`)
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
  const plan = (await sdk.coordinator.plan2.generate({ goal: input.goal, intent, parallel_policy }, { throwOnError: true })).data
  const reviewerModel = parseReviewerModel(input.reviewerModel)
  const nodes = reviewerModel
    ? plan.nodes.map((node) => (node.role === "reviewer" ? { ...node, model: reviewerModel } : node))
    : plan.nodes
  emit(input.format, "plan", { plan: { ...plan, nodes }, sessionID })
  const mode = input.mode ?? (intent.risk_level === "high" ? "assisted" : "autonomous")
  const run = (
    await sdk.coordinator.run(
      {
        sessionID,
        goal: input.goal,
        intent,
        nodes,
        mode,
        approved: input.approve,
        parallel_policy,
      },
      { throwOnError: true },
    )
  ).data
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
      })
    })
  },
})
