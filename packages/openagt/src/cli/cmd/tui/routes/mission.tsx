import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useEvent } from "@tui/context/event"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { Spinner } from "@tui/component/spinner"

type CoordinatorTask = {
  task_id: string
  child_session_id: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  description: string
  result_summary?: string
  error_summary?: string
  read_scope: string[]
  write_scope: string[]
  acceptance_checks: string[]
  metadata?: Record<string, unknown>
}

type CoordinatorGroup = {
  id: string
  node_ids: string[]
  task_ids: string[]
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  merge_status: "none" | "waiting" | "merged" | "conflict"
  blocked_by: string[]
  conflicts: string[]
  started_at?: number
  completed_at?: number
}

type CoordinatorProjection = {
  run: {
    id: string
    sessionID: string
    goal: string
    mode: "manual" | "assisted" | "autonomous"
    workflow: string
    state: "settling_intent" | "awaiting_approval" | "planned" | "active" | "blocked" | "completed" | "failed" | "cancelled"
    summary?: string
    intent: {
      risk_level: "low" | "medium" | "high"
      task_type: string
      expected_output: string
      permission_expectations: string[]
      clarification_questions: string[]
    }
    plan: {
      nodes: Array<{
        id: string
        role: string
        description: string
        task_kind: string
        risk: string
        depends_on: string[]
        read_scope: string[]
        write_scope: string[]
        parallel_group?: string
        assigned_scope: string[]
        excluded_scope: string[]
        merge_status: "none" | "waiting" | "merged" | "conflict"
        conflicts: string[]
        acceptance_checks: string[]
        model?: {
          providerID: string
          modelID: string
        }
      }>
    }
  }
  tasks: CoordinatorTask[]
  counts: Record<"pending" | "running" | "completed" | "failed" | "cancelled", number>
  groups: CoordinatorGroup[]
}

function taskNodeID(task: CoordinatorTask) {
  return typeof task.metadata?.coordinator_node_id === "string" ? task.metadata.coordinator_node_id : undefined
}

function taskRole(task: CoordinatorTask) {
  return typeof task.metadata?.role === "string" ? task.metadata.role : "subagent"
}

function taskModel(task: CoordinatorTask) {
  const model = task.metadata?.model
  if (!model || typeof model !== "object" || Array.isArray(model)) return
  const value = model as Record<string, unknown>
  if (typeof value.providerID !== "string" || typeof value.modelID !== "string") return
  return `${value.providerID}/${value.modelID}`
}

function modelLabel(node: { model?: { providerID: string; modelID: string } }, task?: CoordinatorTask) {
  if (node.model) return `${node.model.providerID}/${node.model.modelID}`
  if (!task) return undefined
  return taskModel(task)
}

export function Mission() {
  const route = useRouteData("mission")
  const router = useRoute()
  const sdk = useSDK()
  const event = useEvent()
  const toast = useToast()
  const { theme } = useTheme()
  const [projection, setProjection] = createSignal<CoordinatorProjection>()
  const [busy, setBusy] = createSignal<string>()

  async function refresh() {
    const result = await sdk.client.coordinator.projection({ runID: route.runID }, { throwOnError: true })
    setProjection(result.data as unknown as CoordinatorProjection)
  }

  async function action(name: "approve" | "cancel" | "resume" | "retry") {
    try {
      setBusy(name)
      if (name === "approve") await sdk.client.coordinator.approve({ runID: route.runID }, { throwOnError: true })
      if (name === "cancel") await sdk.client.coordinator.cancel({ runID: route.runID }, { throwOnError: true })
      if (name === "resume") await sdk.client.coordinator.resume({ runID: route.runID }, { throwOnError: true })
      if (name === "retry") await sdk.client.coordinator.retry({ runID: route.runID }, { throwOnError: true })
      await refresh()
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy(undefined)
    }
  }

  createEffect(() => {
    refresh().catch((error) => toast.error(error))
  })

  event.on("coordinator.created", (evt) => {
    if (evt.properties.id === route.runID) void refresh().catch((error) => toast.error(error))
  })
  event.on("coordinator.updated", (evt) => {
    if (evt.properties.id === route.runID) void refresh().catch((error) => toast.error(error))
  })
  event.on("coordinator.completed", (evt) => {
    if (evt.properties.id === route.runID) void refresh().catch((error) => toast.error(error))
  })
  event.on("task.updated", (evt) => {
    if (evt.properties.result.group_id === route.runID) void refresh().catch((error) => toast.error(error))
  })

  const run = createMemo(() => projection()?.run)
  const tasksByNode = createMemo(() => new Map((projection()?.tasks ?? []).map((task) => [taskNodeID(task), task])))
  const canApprove = createMemo(() => run()?.state === "awaiting_approval")
  const canResume = createMemo(() => run()?.state === "active" || run()?.state === "blocked")
  const canRetry = createMemo(() => run()?.state === "failed" || run()?.state === "cancelled")
  const canCancel = createMemo(() => run()?.state === "active" || run()?.state === "blocked" || run()?.state === "awaiting_approval")

  return (
    <box flexDirection="column" width="100%" height="100%" paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <Show when={projection()} fallback={<Spinner color={theme.textMuted}>Loading mission...</Spinner>}>
        {(data) => (
          <>
            <box flexDirection="row" justifyContent="space-between">
              <box flexDirection="column">
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Mission Control
                </text>
                <text fg={theme.textMuted}>{data().run.goal}</text>
              </box>
              <box flexDirection="column" alignItems="flex-end">
                <text fg={theme.text}>{data().run.state}</text>
                <text fg={theme.textMuted}>
                  {data().run.mode} / {data().run.workflow} / {data().run.intent.risk_level}
                </text>
              </box>
            </box>

            <box flexDirection="row" gap={2}>
              <Show when={canApprove()}>
                <text fg={theme.success} onMouseUp={() => void action("approve")}>
                  approve
                </text>
              </Show>
              <Show when={canResume()}>
                <text fg={theme.info} onMouseUp={() => void action("resume")}>
                  resume
                </text>
              </Show>
              <Show when={canRetry()}>
                <text fg={theme.warning} onMouseUp={() => void action("retry")}>
                  retry
                </text>
              </Show>
              <Show when={canCancel()}>
                <text fg={theme.error} onMouseUp={() => void action("cancel")}>
                  cancel
                </text>
              </Show>
              <text fg={theme.textMuted} onMouseUp={() => void refresh()}>
                refresh
              </text>
              <text fg={theme.textMuted} onMouseUp={() => router.navigate({ type: "session", sessionID: data().run.sessionID })}>
                root session
              </text>
              <Show when={busy()}>
                {(name) => <Spinner color={theme.textMuted}>{name()}...</Spinner>}
              </Show>
            </box>

            <box flexDirection="row" gap={2}>
              <text fg={theme.success}>{data().counts.completed} completed</text>
              <text fg={theme.info}>{data().counts.running} running</text>
              <text fg={theme.textMuted}>{data().counts.pending} pending</text>
              <text fg={theme.error}>{data().counts.failed} failed</text>
              <text fg={theme.warning}>{data().counts.cancelled} cancelled</text>
            </box>

            <Show when={data().groups.length > 0}>
              <box flexDirection="column" gap={0}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Parallel Groups
                </text>
                <For each={data().groups}>
                  {(group) => (
                    <box flexDirection="column" paddingLeft={1}>
                      <box flexDirection="row" gap={1}>
                        <text fg={theme.text}>{group.id}</text>
                        <text fg={theme[group.status === "failed" ? "error" : group.status === "running" ? "info" : group.status === "completed" ? "success" : "textMuted"]}>
                          {group.status}
                        </text>
                        <text fg={theme.textMuted}>merge: {group.merge_status}</text>
                      </box>
                      <text fg={theme.textMuted}>nodes: {group.node_ids.join(", ")}</text>
                      <Show when={group.blocked_by.length > 0}>
                        <text fg={theme.warning}>blocked by: {group.blocked_by.join(", ")}</text>
                      </Show>
                      <Show when={group.conflicts.length > 0}>
                        <text fg={theme.error}>conflicts: {group.conflicts.join("; ")}</text>
                      </Show>
                    </box>
                  )}
                </For>
              </box>
            </Show>

            <box flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                DAG
              </text>
              <For each={data().run.plan.nodes}>
                {(node) => {
                  const task = () => tasksByNode().get(node.id)
                  return (
                    <box flexDirection="column" paddingLeft={1}>
                      <box flexDirection="row" gap={1}>
                        <text fg={theme.text}>{node.id}</text>
                        <text fg={theme.textMuted}>
                          [{node.role}/{node.task_kind}/{node.risk}{node.parallel_group ? `/group:${node.parallel_group}` : ""}]
                        </text>
                        <text fg={theme[node.risk === "high" ? "error" : node.risk === "medium" ? "warning" : "success"]}>
                          {task()?.status ?? "pending"}
                        </text>
                        <Show when={modelLabel(node, task())}>
                          {(model) => <text fg={theme.textMuted}>{model()}</text>}
                        </Show>
                        <Show when={task()}>
                          {(value) => (
                            <text
                              fg={theme.info}
                              onMouseUp={() => router.navigate({ type: "session", sessionID: value().child_session_id })}
                            >
                              open
                            </text>
                          )}
                        </Show>
                      </box>
                      <text fg={theme.textMuted} wrapMode="word">
                        {node.description}
                      </text>
                      <Show when={node.depends_on.length > 0}>
                        <text fg={theme.textMuted}>depends on: {node.depends_on.join(", ")}</text>
                      </Show>
                      <Show when={node.assigned_scope.length > 0}>
                        <text fg={theme.textMuted}>scope: {node.assigned_scope.join(", ")}</text>
                      </Show>
                      <Show when={node.acceptance_checks.length > 0}>
                        <text fg={theme.textMuted}>checks: {node.acceptance_checks.join("; ")}</text>
                      </Show>
                      <Switch>
                        <Match when={task()?.result_summary}>
                          <text fg={theme.success} wrapMode="word">
                            result: {task()?.result_summary}
                          </text>
                        </Match>
                        <Match when={task()?.error_summary}>
                          <text fg={theme.error} wrapMode="word">
                            error: {task()?.error_summary}
                          </text>
                        </Match>
                      </Switch>
                    </box>
                  )
                }}
              </For>
            </box>
          </>
        )}
      </Show>
    </box>
  )
}
