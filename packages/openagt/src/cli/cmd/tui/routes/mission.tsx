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
  status: "pending" | "running" | "completed" | "partial" | "failed" | "cancelled"
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
    state:
      | "settling_intent"
      | "awaiting_approval"
      | "planned"
      | "active"
      | "blocked"
      | "completed"
      | "failed"
      | "cancelled"
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
  counts: Record<"pending" | "running" | "completed" | "partial" | "failed" | "cancelled", number>
  groups: CoordinatorGroup[]
  effort_profile?: {
    planning_rounds: number
    verifier_count_min: number
    revise_policy: string
    max_revise_nodes: number
  }
  long_task?: {
    is_long_task: boolean
    task_size: string
    execution_model?: string
    classification?: string
    confidence?: string
    trigger_score?: number
    milestone_count?: number
    timeline_required: boolean
    positive_signals?: string[]
    negative_signals?: string[]
    needs_user_confirmation?: boolean
  }
  todo_timeline?: {
    current_milestone_id?: string
    milestones: Array<{
      id: string
      title: string
      status: "pending" | "active" | "completed" | "partial" | "blocked" | "skipped"
      expected_artifact: string
      budget_slice: number
    }>
    checkpoints: Array<{
      id: string
      type: string
      milestone_id?: string
      summary: string
      next_recommended_action: string
    }>
    evidence_ledger: Array<{
      id: string
      source_id: string
      milestone_id?: string
      summary: string
    }>
    memory_slices: Array<{
      id: string
      milestone_id?: string
      next_context: string
    }>
  }
  budget_state?: {
    budget_limited: boolean
    ceiling_hit: boolean
    checkpoint_count: number
    soft_budget_used: number
    absolute_ceiling_used: number
  }
  progress_snapshot?: {
    progress_score: number
    evidence_coverage: number
    confidence: string
  }
  checkpoint_memory?: {
    checkpoint_id?: string
    checkpoint_type?: string
    current_milestone_id?: string
    compressed_context: string
    next_recommended_todos: string[]
    milestone_summaries: string[]
  }
  continuation_request?: {
    reason: string
    next_todos: string[]
    expected_value: string
    requires_user_approval: boolean
  }
  quality_gates?: Array<{ id: string; kind: string; status: string }>
  revise_points?: Array<{ id: string; kind: string; status: string }>
  expert_lanes?: Array<{ id: string; expert_id: string; role: string; node_ids: string[] }>
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

  async function action(name: "approve" | "cancel" | "resume" | "retry" | "continue", nodeID?: string) {
    try {
      setBusy(name)
      if (name === "approve") await sdk.client.coordinator.approve({ runID: route.runID }, { throwOnError: true })
      if (name === "cancel") await sdk.client.coordinator.cancel({ runID: route.runID }, { throwOnError: true })
      if (name === "resume") await sdk.client.coordinator.resume({ runID: route.runID }, { throwOnError: true })
      if (name === "retry")
        await sdk.client.coordinator.retry({ runID: route.runID, node_id: nodeID }, { throwOnError: true })
      if (name === "continue") await sdk.client.coordinator.continue({ runID: route.runID }, { throwOnError: true })
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
  const canContinue = createMemo(
    () =>
      projection()?.budget_state?.budget_limited === true ||
      projection()?.budget_state?.ceiling_hit === true ||
      Boolean(projection()?.continuation_request),
  )
  const canCancel = createMemo(
    () => run()?.state === "active" || run()?.state === "blocked" || run()?.state === "awaiting_approval",
  )

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
              <Show when={canContinue()}>
                <text fg={theme.success} onMouseUp={() => void action("continue")}>
                  continue
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
              <text
                fg={theme.textMuted}
                onMouseUp={() => router.navigate({ type: "session", sessionID: data().run.sessionID })}
              >
                root session
              </text>
              <Show when={busy()}>{(name) => <Spinner color={theme.textMuted}>{name()}...</Spinner>}</Show>
            </box>

            <box flexDirection="row" gap={2}>
              <text fg={theme.success}>{data().counts.completed} completed</text>
              <text fg={theme.info}>{data().counts.running} running</text>
              <text fg={theme.warning}>{data().counts.partial} partial</text>
              <text fg={theme.textMuted}>{data().counts.pending} pending</text>
              <text fg={theme.error}>{data().counts.failed} failed</text>
              <text fg={theme.warning}>{data().counts.cancelled} cancelled</text>
            </box>

            <Show when={data().long_task?.is_long_task || data().todo_timeline?.milestones.length}>
              <box flexDirection="column" gap={0}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Long Task
                </text>
                <box flexDirection="row" gap={2}>
                  <text fg={theme.textMuted}>
                    {data().long_task?.execution_model ?? data().long_task?.task_size ?? "short-task"}
                  </text>
                  <text fg={theme.textMuted}>
                    {data().long_task?.confidence ?? "medium"} / score {data().long_task?.trigger_score ?? 0}
                  </text>
                  <text fg={theme.textMuted}>current: {data().todo_timeline?.current_milestone_id ?? "none"}</text>
                  <Show when={data().progress_snapshot}>
                    {(progress) => (
                      <text fg={theme.textMuted}>
                        progress {Math.round(progress().progress_score * 100)}% / evidence{" "}
                        {Math.round(progress().evidence_coverage * 100)}%
                      </text>
                    )}
                  </Show>
                  <Show when={data().budget_state}>
                    {(budget) => (
                      <text
                        fg={
                          budget().ceiling_hit ? theme.error : budget().budget_limited ? theme.warning : theme.textMuted
                        }
                      >
                        budget {Math.round(budget().soft_budget_used * 100)}%
                      </text>
                    )}
                  </Show>
                </box>
                <Show when={data().long_task?.positive_signals?.length}>
                  <text fg={theme.textMuted} wrapMode="word">
                    why: {(data().long_task?.positive_signals ?? []).slice(0, 4).join("; ")}
                  </text>
                </Show>
                <Show when={data().long_task?.negative_signals?.length}>
                  <text fg={theme.warning} wrapMode="word">
                    counter: {(data().long_task?.negative_signals ?? []).slice(0, 3).join("; ")}
                  </text>
                </Show>
                <Show when={data().long_task?.needs_user_confirmation}>
                  <text fg={theme.warning}>confirmation recommended before continuation</text>
                </Show>
                <For each={data().todo_timeline?.milestones ?? []}>
                  {(milestone) => (
                    <box flexDirection="column" paddingLeft={1}>
                      <text
                        fg={
                          theme[
                            milestone.status === "blocked"
                              ? "error"
                              : milestone.status === "active"
                                ? "info"
                                : milestone.status === "completed"
                                  ? "success"
                                  : "textMuted"
                          ]
                        }
                      >
                        {milestone.id} [{milestone.status}] {milestone.title} {Math.round(milestone.budget_slice * 100)}
                        %
                      </text>
                      <Show when={milestone.expected_artifact}>
                        <text fg={theme.textMuted}>artifact: {milestone.expected_artifact}</text>
                      </Show>
                    </box>
                  )}
                </For>
                <Show when={data().continuation_request}>
                  {(request) => (
                    <box flexDirection="column" paddingLeft={1}>
                      <text fg={request().requires_user_approval ? theme.warning : theme.info}>
                        continuation: {request().reason}
                      </text>
                      <text fg={theme.textMuted}>next: {request().next_todos.join(", ") || "none"}</text>
                      <text fg={theme.textMuted} wrapMode="word">
                        value: {request().expected_value}
                      </text>
                    </box>
                  )}
                </Show>
                <Show when={data().todo_timeline?.checkpoints.length}>
                  <box flexDirection="column" paddingLeft={1}>
                    <text fg={theme.text} attributes={TextAttributes.BOLD}>
                      Checkpoints
                    </text>
                    <For each={(data().todo_timeline?.checkpoints ?? []).slice(-6)}>
                      {(checkpoint) => (
                        <text fg={theme.textMuted} wrapMode="word">
                          {checkpoint.id} [{checkpoint.type}] {checkpoint.summary}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
                <Show when={data().checkpoint_memory?.compressed_context}>
                  <text fg={theme.textMuted} wrapMode="word">
                    memory: {data().checkpoint_memory?.compressed_context}
                  </text>
                </Show>
              </box>
            </Show>

            <Show
              when={
                data().effort_profile ||
                data().quality_gates?.length ||
                data().revise_points?.length ||
                data().expert_lanes?.length
              }
            >
              <box flexDirection="column" gap={0}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Quality
                </text>
                <Show when={data().effort_profile}>
                  {(effort) => (
                    <text fg={theme.textMuted}>
                      effort: planning {effort().planning_rounds}, verifiers {effort().verifier_count_min}, revise{" "}
                      {effort().revise_policy}, max revise {effort().max_revise_nodes}
                    </text>
                  )}
                </Show>
                <Show when={data().quality_gates?.length}>
                  <text fg={theme.textMuted}>
                    gates: {(data().quality_gates ?? []).map((item) => `${item.id}:${item.status}`).join(", ")}
                  </text>
                </Show>
                <Show when={data().revise_points?.length}>
                  <text fg={theme.textMuted}>
                    revise: {(data().revise_points ?? []).map((item) => `${item.kind}:${item.status}`).join(", ")}
                  </text>
                </Show>
                <Show when={data().expert_lanes?.length}>
                  <text fg={theme.textMuted}>
                    experts:{" "}
                    {(data().expert_lanes ?? []).map((item) => `${item.expert_id}(${item.node_ids.length})`).join(", ")}
                  </text>
                </Show>
              </box>
            </Show>

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
                        <text
                          fg={
                            theme[
                              group.status === "failed"
                                ? "error"
                                : group.status === "running"
                                  ? "info"
                                  : group.status === "completed"
                                    ? "success"
                                    : "textMuted"
                            ]
                          }
                        >
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
                          [{node.role}/{node.task_kind}/{node.risk}
                          {node.parallel_group ? `/group:${node.parallel_group}` : ""}]
                        </text>
                        <text
                          fg={theme[node.risk === "high" ? "error" : node.risk === "medium" ? "warning" : "success"]}
                        >
                          {task()?.status ?? "pending"}
                        </text>
                        <Show when={modelLabel(node, task())}>
                          {(model) => <text fg={theme.textMuted}>{model()}</text>}
                        </Show>
                        <Show when={task()}>
                          {(value) => (
                            <text
                              fg={theme.info}
                              onMouseUp={() =>
                                router.navigate({ type: "session", sessionID: value().child_session_id })
                              }
                            >
                              open
                            </text>
                          )}
                        </Show>
                        <Show
                          when={
                            task()?.status === "failed" ||
                            task()?.status === "partial" ||
                            task()?.status === "cancelled"
                          }
                        >
                          <text fg={theme.warning} onMouseUp={() => void action("retry", node.id)}>
                            retry
                          </text>
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
