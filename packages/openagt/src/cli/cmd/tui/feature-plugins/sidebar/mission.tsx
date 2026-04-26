import type { CoordinatorListResponse, CoordinatorProjectionResponse, Session, SessionChildrenResponse } from "@openagt/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@openagt/plugin/tui"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"

const id = "internal:sidebar-mission"

type CoordinatorRun = CoordinatorListResponse[number]
type CoordinatorProjection = CoordinatorProjectionResponse
type ChildSession = SessionChildrenResponse[number]
type CoordinatorNode = CoordinatorProjection["run"]["plan"]["nodes"][number]
type CoordinatorTask = CoordinatorProjection["tasks"][number]
type CoordinatorLane = CoordinatorProjection["expert_lanes"][number]
type TaskStatus = CoordinatorTask["status"]
type SessionStageStatus = "idle" | "busy" | "retry" | "unknown"

type ExpertOverview = {
  id: string
  role: string
  workflow: string
  status: TaskStatus
  task_count: number
  running: number
  completed: number
}

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled"])

function taskNodeID(task: CoordinatorTask) {
  return typeof task.metadata?.coordinator_node_id === "string" ? task.metadata.coordinator_node_id : undefined
}

function taskMetadata(task: CoordinatorTask, key: string) {
  return typeof task.metadata?.[key] === "string" ? task.metadata[key] : undefined
}

function nodeRole(node: CoordinatorNode) {
  return node.expert_role ?? node.role ?? node.task_kind
}

function taskRole(task: CoordinatorTask) {
  return taskMetadata(task, "expert_role") ?? taskMetadata(task, "role") ?? task.task_kind
}

function statusMark(status: TaskStatus) {
  if (status === "running") return ">"
  if (status === "completed") return "+"
  if (status === "failed") return "x"
  if (status === "cancelled") return "!"
  return "-"
}

function statusColor(theme: TuiPluginApi["theme"]["current"], status: TaskStatus) {
  if (status === "running") return theme.info
  if (status === "completed") return theme.success
  if (status === "failed") return theme.error
  if (status === "cancelled") return theme.warning
  return theme.textMuted
}

function sessionStatusColor(theme: TuiPluginApi["theme"]["current"], status: SessionStageStatus) {
  if (status === "busy") return theme.info
  if (status === "retry") return theme.warning
  if (status === "idle") return theme.success
  return theme.textMuted
}

function sessionStatusMark(status: SessionStageStatus) {
  if (status === "busy") return ">"
  if (status === "retry") return "!"
  if (status === "idle") return "+"
  return "-"
}

function sessionLabel(session: ChildSession) {
  return session.title.match(/@(\w+) subagent/)?.[1] ?? "subagent"
}

function sessionStatus(api: TuiPluginApi, sessionID: string): SessionStageStatus {
  const status = api.state.session.status(sessionID)?.type
  if (status === "busy" || status === "retry" || status === "idle") return status
  return "unknown"
}

function aggregateStatus(tasks: CoordinatorTask[]): TaskStatus {
  if (tasks.some((task) => task.status === "failed")) return "failed"
  if (tasks.some((task) => task.status === "running")) return "running"
  if (tasks.some((task) => task.status === "cancelled")) return "cancelled"
  if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) return "completed"
  return "pending"
}

function runTime(run: CoordinatorRun) {
  return run.time.updated ?? run.time.created
}

function pickRun(runs: CoordinatorRun[]) {
  const sorted = [...runs].sort((a, b) => runTime(b) - runTime(a))
  return sorted.find((run) => !TERMINAL_RUN_STATES.has(run.state)) ?? sorted[0]
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function rootSessionID(api: TuiPluginApi, sessionID: string, depth = 0): Promise<string> {
  if (depth >= 8) return Promise.resolve(sessionID)
  return api.client.session
    .get({ sessionID }, { throwOnError: true })
    .then((result) => {
      const session = result.data as Session
      if (!session.parentID) return session.id
      return rootSessionID(api, session.parentID, depth + 1)
    })
    .catch(() => sessionID)
}

async function loadProjection(api: TuiPluginApi, sessionID: string) {
  const root = await rootSessionID(api, sessionID)
  const [runs, children] = await Promise.all([
    api.client.coordinator.list({ sessionID: root }, { throwOnError: true }).then((result) => result.data as CoordinatorRun[]),
    api.client.session.children({ sessionID: root }, { throwOnError: true }).then((result) => result.data as ChildSession[]),
  ])
  const run = pickRun(runs)
  if (!run) return { root, children }
  return {
    root,
    children,
    projection: (await api.client.coordinator.projection({ runID: run.id }, { throwOnError: true }))
      .data as CoordinatorProjection,
  }
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [root, setRoot] = createSignal<string>()
  const [projection, setProjection] = createSignal<CoordinatorProjection>()
  const [childSessions, setChildSessions] = createSignal<ChildSession[]>([])
  const [error, setError] = createSignal<string>()
  const [loading, setLoading] = createSignal(false)
  let request = 0

  function refresh() {
    const current = request + 1
    request = current
    setLoading(true)
    loadProjection(props.api, props.session_id)
      .then((result) => {
        if (current !== request) return
        setRoot(result.root)
        setChildSessions(result.children ?? [])
        setProjection(result.projection)
        setError(undefined)
      })
      .catch((err) => {
        if (current !== request) return
        setError(errorMessage(err))
      })
      .finally(() => current === request && setLoading(false))
  }

  createEffect(() => {
    props.session_id
    refresh()
  })

  const off = [
    props.api.event.on("coordinator.created", (evt) => {
      if (evt.properties.sessionID === root()) refresh()
    }),
    props.api.event.on("coordinator.updated", (evt) => {
      if (evt.properties.id === projection()?.run.id || evt.properties.sessionID === root()) refresh()
    }),
    props.api.event.on("coordinator.completed", (evt) => {
      if (evt.properties.id === projection()?.run.id || evt.properties.sessionID === root()) refresh()
    }),
    props.api.event.on("task.updated", (evt) => {
      if (
        evt.properties.result.group_id === projection()?.run.id ||
        evt.properties.parent_session_id === root() ||
        evt.properties.result.child_session_id === props.session_id
      )
        refresh()
    }),
    props.api.event.on("session.created", (evt) => {
      if (evt.properties.info.parentID === root() || evt.properties.sessionID === root()) refresh()
    }),
    props.api.event.on("session.updated", (evt) => {
      if (evt.properties.info.parentID === root() || evt.properties.sessionID === root()) refresh()
    }),
    props.api.event.on("session.status", (evt) => {
      if (evt.properties.sessionID === props.session_id || childSessions().some((session) => session.id === evt.properties.sessionID))
        refresh()
    }),
  ]
  onCleanup(() => off.forEach((dispose) => dispose()))

  const tasksByNode = createMemo(
    () =>
      new Map(
        (projection()?.tasks ?? [])
          .map((task) => [taskNodeID(task), task] as const)
          .filter((entry): entry is readonly [string, CoordinatorTask] => typeof entry[0] === "string"),
      ),
  )
  const nodes = createMemo(() => projection()?.run.plan.nodes ?? [])
  const currentTask = createMemo(() => projection()?.tasks.find((task) => task.child_session_id === props.session_id))
  const visibleStages = createMemo(() => nodes().slice(0, 8))
  const runningTasks = createMemo(() => projection()?.tasks.filter((task) => task.status === "running") ?? [])
  const nextPendingNodes = createMemo(() =>
    nodes()
      .filter((node) => (tasksByNode().get(node.id)?.status ?? "pending") === "pending")
      .slice(0, 3),
  )
  const currentStages = createMemo(() => {
    const task = currentTask()
    if (task) return [{ node: nodes().find((item) => item.id === taskNodeID(task)), task }]
    const running = runningTasks()
    if (running.length > 0) return running.map((item) => ({ node: nodes().find((node) => node.id === taskNodeID(item)), task: item }))
    return nextPendingNodes().map((node) => ({ node, task: tasksByNode().get(node.id) }))
  })
  const qualityGateSummary = createMemo(() => {
    const gates = projection()?.quality_gates ?? []
    return {
      total: gates.length,
      running: gates.filter((gate) => gate.status === "running").length,
      failed: gates.filter((gate) => gate.status === "failed").length,
      pending: gates.filter((gate) => !gate.status || gate.status === "pending").length,
    }
  })
  const expertRows = createMemo<ExpertOverview[]>(() => {
    const data = projection()
    if (!data) return []
    if (data.expert_lanes.length > 0)
      return data.expert_lanes.slice(0, 6).map((lane: CoordinatorLane) => {
        const tasks = lane.node_ids.flatMap((nodeID) => {
          const task = tasksByNode().get(nodeID)
          return task ? [task] : []
        })
        return {
          id: lane.expert_id,
          role: lane.role,
          workflow: lane.workflow,
          status: aggregateStatus(tasks),
          task_count: tasks.length,
          running: tasks.filter((task) => task.status === "running").length,
          completed: tasks.filter((task) => task.status === "completed").length,
        }
      })

    return Object.entries(
      data.tasks.reduce<Record<string, CoordinatorTask[]>>((acc, task) => {
        const expert = taskMetadata(task, "expert_id") ?? taskRole(task)
        return {
          ...acc,
          [expert]: [...(acc[expert] ?? []), task],
        }
      }, {}),
    )
      .map(([expert, tasks]) => ({
        id: expert,
        role: taskRole(tasks[0]),
        workflow: taskMetadata(tasks[0], "workflow") ?? data.run.workflow,
        status: aggregateStatus(tasks),
        task_count: tasks.length,
        running: tasks.filter((task) => task.status === "running").length,
        completed: tasks.filter((task) => task.status === "completed").length,
      }))
      .slice(0, 6)
  })
  const sortedChildSessions = createMemo(() => [...childSessions()].sort((a, b) => a.time.created - b.time.created))
  const currentChild = createMemo(() => sortedChildSessions().find((session) => session.id === props.session_id))
  const currentSessionStatus = createMemo(() => sessionStatus(props.api, props.session_id))
  const currentSessionMessages = createMemo(() => props.api.state.session.messages(props.session_id))
  const currentStageLabel = createMemo(() => {
    if (currentSessionStatus() === "busy") return "agent responding"
    if (currentSessionStatus() === "retry") return "retrying"
    const last = currentSessionMessages().at(-1)
    if (!last) return "ready"
    if (last.role === "assistant") return "response complete"
    return "awaiting response"
  })
  const sessionStages = createMemo(() => {
    const messages = currentSessionMessages()
    return [
      { label: messages.some((message) => message.role === "user") ? "prompt received" : "ready", status: "idle" as const },
      ...(currentSessionStatus() === "busy" ? [{ label: "agent running", status: "busy" as const }] : []),
      ...(currentSessionStatus() === "retry" ? [{ label: "retrying", status: "retry" as const }] : []),
      ...(messages.some((message) => message.role === "assistant")
        ? [{ label: "response complete", status: "idle" as const }]
        : []),
    ]
  })
  const childStatusCounts = createMemo(() =>
    sortedChildSessions().reduce(
      (acc, session) => ({
        ...acc,
        [sessionStatus(props.api, session.id)]: acc[sessionStatus(props.api, session.id)] + 1,
      }),
      { idle: 0, busy: 0, retry: 0, unknown: 0 },
    ),
  )

  return (
    <Show
      when={projection()}
      fallback={
        <box gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme().text}>
              <b>Task</b>
            </text>
            <Show when={loading()}>
              <text fg={theme().textMuted}>syncing...</text>
            </Show>
          </box>

          <box>
            <text fg={theme().textMuted}>current stage</text>
            <text fg={sessionStatusColor(theme(), currentSessionStatus())} wrapMode="word">
              {sessionStatusMark(currentSessionStatus())} {currentStageLabel()} / {currentSessionStatus()}
            </text>
          </box>

          <box>
            <text fg={theme().text}>
              <b>Agent Status</b>
            </text>
            <text fg={sessionStatusColor(theme(), currentSessionStatus())}>{currentSessionStatus()}</text>
            <text fg={theme().textMuted}>
              {currentSessionMessages().length} messages, {sortedChildSessions().length} subagents
            </text>
            <Show when={sortedChildSessions().length > 0}>
              <text fg={theme().textMuted}>
                {childStatusCounts().busy} busy, {childStatusCounts().retry} retry, {childStatusCounts().idle} idle
              </text>
            </Show>
          </box>

          <box>
            <text fg={theme().text}>
              <b>Stages</b>
            </text>
            <For each={sessionStages()}>
              {(stage) => (
                <box flexDirection="row" gap={1}>
                  <text fg={sessionStatusColor(theme(), stage.status)}>{sessionStatusMark(stage.status)}</text>
                  <text fg={sessionStatusColor(theme(), stage.status)} wrapMode="word">
                    {stage.label}
                  </text>
                </box>
              )}
            </For>
            <For each={sortedChildSessions().slice(0, 6)}>
              {(session) => {
                const status = () => sessionStatus(props.api, session.id)
                return (
                  <box flexDirection="row" gap={1}>
                    <text fg={sessionStatusColor(theme(), status())}>{session.id === props.session_id ? ">" : sessionStatusMark(status())}</text>
                    <text fg={sessionStatusColor(theme(), status())} wrapMode="word">
                      {sessionLabel(session)} {status()}
                    </text>
                  </box>
                )
              }}
            </For>
            <Show when={sortedChildSessions().length > 6}>
              <text fg={theme().textMuted}>+{sortedChildSessions().length - 6} more stages</text>
            </Show>
          </box>

          <box>
            <text fg={theme().text}>
              <b>Subagents</b>
            </text>
            <Show when={sortedChildSessions().length > 0} fallback={<text fg={theme().textMuted}>none</text>}>
              <For each={sortedChildSessions().slice(0, 6)}>
                {(session) => (
                  <box>
                    <text
                      fg={sessionStatusColor(theme(), sessionStatus(props.api, session.id))}
                      wrapMode="word"
                      onMouseUp={() => props.api.route.navigate("session", { sessionID: session.id })}
                    >
                      {sessionLabel(session)}
                    </text>
                    <text fg={theme().textMuted} wrapMode="word">
                      {session.title}
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </box>

          <Show when={error()}>
            {(message) => (
              <text fg={theme().error} wrapMode="word">
                sync failed: {message()}
              </text>
            )}
          </Show>
        </box>
      }
    >
      {(data) => (
        <box gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme().text}>
              <b>Mission</b>
            </text>
            <text fg={theme().info} onMouseUp={() => props.api.route.navigate("mission", { runID: data().run.id, sessionID: data().run.sessionID })}>
              open
            </text>
          </box>

          <box>
            <text fg={theme().textMuted} wrapMode="word">
              {data().run.workflow} / {data().run.effort} / {data().run.state}
            </text>
            <Show when={data().specialization_fallback}>
              <text fg={theme().warning}>specialization fallback</text>
            </Show>
            <Show when={data().budget_limited}>
              <text fg={theme().warning}>budget limited</text>
            </Show>
            <Show when={loading()}>
              <text fg={theme().textMuted}>syncing...</text>
            </Show>
            <Show when={error()}>
              {(message) => (
                <text fg={theme().error} wrapMode="word">
                  sync failed: {message()}
                </text>
              )}
            </Show>
          </box>

          <box>
            <text fg={theme().text}>
              <b>Agent Status</b>
            </text>
            <text fg={theme().textMuted}>
              {data().counts.completed}/{data().tasks.length} done, {data().counts.running} running
            </text>
            <text fg={theme().textMuted}>
              {data().counts.pending} pending, {data().counts.failed} failed, {data().counts.cancelled} cancelled
            </text>
            <Show when={qualityGateSummary().total > 0}>
              <text fg={qualityGateSummary().failed > 0 ? theme().error : theme().textMuted}>
                gates {qualityGateSummary().total}: {qualityGateSummary().pending} pending, {qualityGateSummary().running} running,{" "}
                {qualityGateSummary().failed} failed
              </text>
            </Show>
          </box>

          <box>
            <text fg={theme().text}>
              <b>Current Stages</b>
            </text>
            <Show when={currentStages().length > 0} fallback={<text fg={theme().textMuted}>no active stage</text>}>
              <For each={currentStages().slice(0, 4)}>
                {(item) => (
                  <text fg={statusColor(theme(), item.task?.status ?? "pending")} wrapMode="word">
                    {statusMark(item.task?.status ?? "pending")} {item.node?.id ?? taskNodeID(item.task!)} {item.node ? nodeRole(item.node) : item.task ? taskRole(item.task) : "stage"}
                  </text>
                )}
              </For>
            </Show>
          </box>

          <box>
            <text fg={theme().text}>
              <b>Stages</b>
            </text>
            <For each={visibleStages()}>
              {(node) => {
                const task = () => tasksByNode().get(node.id)
                const status = () => task()?.status ?? "pending"
                return (
                  <box flexDirection="row" gap={1}>
                    <text fg={statusColor(theme(), status())}>{statusMark(status())}</text>
                    <text fg={statusColor(theme(), status())} wrapMode="word">
                      {node.id} {nodeRole(node)}
                    </text>
                  </box>
                )
              }}
            </For>
            <Show when={nodes().length > visibleStages().length}>
              <text fg={theme().textMuted}>+{nodes().length - visibleStages().length} more stages</text>
            </Show>
          </box>

          <Show when={expertRows().length > 0}>
            <box>
              <text fg={theme().text}>
                <b>Subagents</b>
              </text>
              <For each={expertRows()}>
                {(expert) => (
                  <box>
                    <text fg={statusColor(theme(), expert.status)} wrapMode="word">
                      {statusMark(expert.status)} {expert.role}
                    </text>
                    <text fg={theme().textMuted} wrapMode="word">
                      {expert.id} / {expert.workflow}
                    </text>
                    <text fg={theme().textMuted}>
                      {expert.completed}/{expert.task_count} done, {expert.running} running
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 250,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
