function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isCoordinatorGroup(value: unknown): value is CoordinatorProjectionGroup {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (!isStringArray(value.node_ids)) return false
  if (!isStringArray(value.task_ids)) return false
  if (!["pending", "running", "completed", "partial", "failed", "cancelled"].includes(String(value.status)))
    return false
  if (!["none", "waiting", "merged", "conflict"].includes(String(value.merge_status))) return false
  return true
}

function isEffortProfile(value: unknown): value is CoordinatorEffortProfile {
  if (!isRecord(value)) return false
  if (typeof value.planning_rounds !== "number") return false
  if (typeof value.expert_count_min !== "number") return false
  if (typeof value.expert_count_max !== "number") return false
  if (typeof value.verifier_count_min !== "number") return false
  if (typeof value.reducer_enabled !== "boolean") return false
  if (typeof value.reviewer_enabled !== "boolean") return false
  if (typeof value.debugger_enabled !== "boolean") return false
  if (!["none", "critical_only", "all_artifacts"].includes(String(value.revise_policy))) return false
  if (typeof value.max_revise_nodes !== "number") return false
  if (typeof value.max_revision_per_artifact !== "number") return false
  if (typeof value.timeout_multiplier !== "number") return false
  return true
}

function isExpertLane(value: unknown): value is CoordinatorExpertLane {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (typeof value.workflow !== "string") return false
  if (typeof value.role !== "string") return false
  if (typeof value.expert_id !== "string") return false
  if (!isStringArray(value.node_ids)) return false
  if (typeof value.memory_namespace !== "string") return false
  return true
}

function isQualityGate(value: unknown): value is CoordinatorQualityGate {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (typeof value.kind !== "string") return false
  if (typeof value.status !== "string") return false
  if (typeof value.required !== "boolean") return false
  return true
}

function isRevisePoint(value: unknown): value is CoordinatorRevisePoint {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (typeof value.kind !== "string") return false
  if (typeof value.status !== "string") return false
  if (typeof value.required !== "boolean") return false
  return true
}

function isMemoryContext(value: unknown): value is CoordinatorMemoryContext {
  if (!isRecord(value)) return false
  if (!isStringArray(value.scopes)) return false
  if (!isStringArray(value.workflow_tags)) return false
  if (!isStringArray(value.expert_tags)) return false
  if (!isStringArray(value.note_ids)) return false
  return true
}

function isResourceLimit(value: unknown): value is CoordinatorResourceLimit {
  if (!isRecord(value)) return false
  if (!isNumber(value.max_rounds)) return false
  if (!isNumber(value.max_model_calls)) return false
  if (!isNumber(value.max_tool_calls)) return false
  if (!isNumber(value.max_subagents)) return false
  if (!isNumber(value.max_wallclock_ms)) return false
  if (!isNumber(value.max_estimated_tokens)) return false
  return true
}

function isLongTaskProfile(value: unknown): value is CoordinatorLongTaskProfile {
  if (!isRecord(value)) return false
  if (typeof value.is_long_task !== "boolean") return false
  if (!["small", "medium", "large", "huge"].includes(String(value.task_size))) return false
  if (typeof value.timeline_required !== "boolean") return false
  if (!isStringArray(value.reasons)) return false
  return true
}

function isTimelineTodo(value: unknown): value is CoordinatorTimelineTodo {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (typeof value.title !== "string") return false
  if (!["pending", "active", "done", "partial", "blocked", "skipped"].includes(String(value.status))) return false
  if (!isNumber(value.budget_weight)) return false
  if (!isStringArray(value.node_ids)) return false
  if (!isStringArray(value.expert_lane_ids)) return false
  return true
}

function isTodoTimeline(value: unknown): value is CoordinatorTodoTimeline {
  if (!isRecord(value)) return false
  if (typeof value.required !== "boolean") return false
  if (!Array.isArray(value.todos) || value.todos.some((item) => !isTimelineTodo(item))) return false
  if (!Array.isArray(value.phases) || value.phases.some((item) => !isRecord(item) || typeof item.id !== "string"))
    return false
  return true
}

function isBudgetProfile(value: unknown): value is CoordinatorBudgetProfile {
  if (!isRecord(value)) return false
  if (!isResourceLimit(value.mission_ceiling)) return false
  if (!isResourceLimit(value.phase_ceiling)) return false
  if (!isResourceLimit(value.checkpoint_reserve)) return false
  if (!isResourceLimit(value.absolute_ceiling)) return false
  if (!isResourceLimit(value.single_checkpoint_ceiling)) return false
  if (!isRecord(value.todo_budget)) return false
  if (Object.values(value.todo_budget).some((item) => !isResourceLimit(item))) return false
  return true
}

function isBudgetState(value: unknown): value is CoordinatorBudgetState {
  if (!isRecord(value)) return false
  if (!isNumber(value.soft_budget_used)) return false
  if (!isNumber(value.absolute_ceiling_used)) return false
  if (!isNumber(value.checkpoint_count)) return false
  if (typeof value.budget_limited !== "boolean") return false
  if (typeof value.ceiling_hit !== "boolean") return false
  return true
}

function isProgressSnapshot(value: unknown): value is CoordinatorProgressSnapshot {
  if (!isRecord(value)) return false
  if (!isNumber(value.progress_score)) return false
  if (!isNumber(value.evidence_coverage)) return false
  if (!isNumber(value.verifier_quality)) return false
  if (!isNumber(value.tool_success_rate)) return false
  if (!isNumber(value.remaining_work_score)) return false
  if (!isNumber(value.failure_penalty)) return false
  if (!["low", "medium", "high"].includes(String(value.confidence))) return false
  return true
}

function isCheckpointMemorySummary(value: unknown): value is CoordinatorCheckpointMemorySummary {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.todo_state) || value.todo_state.some((item) => !isTimelineTodo(item))) return false
  if (!isStringArray(value.completed_artifacts)) return false
  if (!isStringArray(value.evidence_index)) return false
  if (!isStringArray(value.unresolved_claims)) return false
  if (!isStringArray(value.blocked_reasons)) return false
  if (!isStringArray(value.next_recommended_todos)) return false
  if (typeof value.compressed_context !== "string") return false
  return true
}

function isContinuationRequest(value: unknown): value is CoordinatorContinuationRequest {
  if (!isRecord(value)) return false
  if (typeof value.reason !== "string") return false
  if (!isResourceLimit(value.requested_budget_delta)) return false
  if (!isStringArray(value.next_todos)) return false
  if (typeof value.expected_value !== "string") return false
  if (typeof value.requires_user_approval !== "boolean") return false
  return true
}

export type CoordinatorProjectionGroup = Record<string, unknown> & {
  id: string
  node_ids: string[]
  task_ids: string[]
  status: "pending" | "running" | "completed" | "partial" | "failed" | "cancelled"
  merge_status: "none" | "waiting" | "merged" | "conflict"
}

export type CoordinatorProjection = {
  run: Record<string, unknown>
  tasks: Record<string, unknown>[]
  counts: Record<string, number>
  groups: CoordinatorProjectionGroup[]
  expert_lanes?: CoordinatorExpertLane[]
  quality_gates?: CoordinatorQualityGate[]
  revise_points?: CoordinatorRevisePoint[]
  memory_context?: CoordinatorMemoryContext
  effort_profile?: CoordinatorEffortProfile
  long_task?: CoordinatorLongTaskProfile
  todo_timeline?: CoordinatorTodoTimeline
  budget_profile?: CoordinatorBudgetProfile
  budget_state?: CoordinatorBudgetState
  progress_snapshot?: CoordinatorProgressSnapshot
  checkpoint_memory?: CoordinatorCheckpointMemorySummary
  continuation_request?: CoordinatorContinuationRequest
  budget_limited?: boolean
  specialization_fallback?: boolean
}

export type CoordinatorEffortProfile = Record<string, unknown> & {
  planning_rounds: number
  expert_count_min: number
  expert_count_max: number
  verifier_count_min: number
  reducer_enabled: boolean
  reviewer_enabled: boolean
  debugger_enabled: boolean
  revise_policy: "none" | "critical_only" | "all_artifacts"
  max_revise_nodes: number
  max_revision_per_artifact: number
  timeout_multiplier: number
}

export type CoordinatorExpertLane = Record<string, unknown> & {
  id: string
  workflow: string
  role: string
  expert_id: string
  node_ids: string[]
  memory_namespace: string
}

export type CoordinatorQualityGate = Record<string, unknown> & {
  id: string
  kind: string
  status: string
  required: boolean
}

export type CoordinatorRevisePoint = Record<string, unknown> & {
  id: string
  kind: string
  status: string
  required: boolean
}

export type CoordinatorMemoryContext = Record<string, unknown> & {
  scopes: string[]
  workflow_tags: string[]
  expert_tags: string[]
  note_ids: string[]
}

export type CoordinatorResourceLimit = Record<string, unknown> & {
  max_rounds: number
  max_model_calls: number
  max_tool_calls: number
  max_subagents: number
  max_wallclock_ms: number
  max_estimated_tokens: number
}

export type CoordinatorLongTaskProfile = Record<string, unknown> & {
  is_long_task: boolean
  task_size: "small" | "medium" | "large" | "huge"
  timeline_required: boolean
  reasons: string[]
}

export type CoordinatorTimelineTodo = Record<string, unknown> & {
  id: string
  title: string
  status: "pending" | "active" | "done" | "partial" | "blocked" | "skipped"
  budget_weight: number
  node_ids: string[]
  expert_lane_ids: string[]
}

export type CoordinatorTodoTimeline = Record<string, unknown> & {
  required: boolean
  todos: CoordinatorTimelineTodo[]
  phases: Record<string, unknown>[]
}

export type CoordinatorBudgetProfile = Record<string, unknown> & {
  mission_ceiling: CoordinatorResourceLimit
  phase_ceiling: CoordinatorResourceLimit
  todo_budget: Record<string, CoordinatorResourceLimit>
  checkpoint_reserve: CoordinatorResourceLimit
  absolute_ceiling: CoordinatorResourceLimit
  single_checkpoint_ceiling: CoordinatorResourceLimit
}

export type CoordinatorBudgetState = Record<string, unknown> & {
  soft_budget_used: number
  absolute_ceiling_used: number
  checkpoint_count: number
  budget_limited: boolean
  ceiling_hit: boolean
}

export type CoordinatorProgressSnapshot = Record<string, unknown> & {
  progress_score: number
  evidence_coverage: number
  verifier_quality: number
  tool_success_rate: number
  remaining_work_score: number
  failure_penalty: number
  confidence: "low" | "medium" | "high"
}

export type CoordinatorCheckpointMemorySummary = Record<string, unknown> & {
  todo_state: CoordinatorTimelineTodo[]
  completed_artifacts: string[]
  evidence_index: string[]
  unresolved_claims: string[]
  blocked_reasons: string[]
  next_recommended_todos: string[]
  compressed_context: string
}

export type CoordinatorContinuationRequest = Record<string, unknown> & {
  reason: string
  requested_budget_delta: CoordinatorResourceLimit
  next_todos: string[]
  expected_value: string
  requires_user_approval: boolean
}

export type InboxOverview = {
  inbox: Record<string, number>
  wakeups: Record<string, number>
  memory: {
    profile: number
    workspace: number
    session: number
    recent: Record<string, unknown>[]
  }
}

export function getCoordinatorProjection(value: unknown) {
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (!isRecord(candidate)) return
  if (!isRecord(candidate.run)) return
  if (!Array.isArray(candidate.tasks) || candidate.tasks.some((item) => !isRecord(item))) return
  if (!isRecord(candidate.counts)) return
  if (Object.values(candidate.counts).some((item) => typeof item !== "number")) return
  const groups = candidate.groups === undefined ? [] : candidate.groups
  if (!Array.isArray(groups) || groups.some((item) => !isCoordinatorGroup(item))) return
  if (
    candidate.expert_lanes !== undefined &&
    (!Array.isArray(candidate.expert_lanes) || candidate.expert_lanes.some((item) => !isExpertLane(item)))
  )
    return
  if (
    candidate.quality_gates !== undefined &&
    (!Array.isArray(candidate.quality_gates) || candidate.quality_gates.some((item) => !isQualityGate(item)))
  )
    return
  if (
    candidate.revise_points !== undefined &&
    (!Array.isArray(candidate.revise_points) || candidate.revise_points.some((item) => !isRevisePoint(item)))
  )
    return
  if (candidate.memory_context !== undefined && !isMemoryContext(candidate.memory_context)) return
  if (candidate.effort_profile !== undefined && !isEffortProfile(candidate.effort_profile)) return
  if (candidate.long_task !== undefined && !isLongTaskProfile(candidate.long_task)) return
  if (candidate.todo_timeline !== undefined && !isTodoTimeline(candidate.todo_timeline)) return
  if (candidate.budget_profile !== undefined && !isBudgetProfile(candidate.budget_profile)) return
  if (candidate.budget_state !== undefined && !isBudgetState(candidate.budget_state)) return
  if (candidate.progress_snapshot !== undefined && !isProgressSnapshot(candidate.progress_snapshot)) return
  if (candidate.checkpoint_memory !== undefined && !isCheckpointMemorySummary(candidate.checkpoint_memory)) return
  if (candidate.continuation_request !== undefined && !isContinuationRequest(candidate.continuation_request)) return
  return { ...candidate, groups } as CoordinatorProjection
}

export function getEffortProfile(value: unknown) {
  const projection = getCoordinatorProjection(value)
  if (projection?.effort_profile) return projection.effort_profile
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (isRecord(candidate) && isEffortProfile(candidate.effort_profile)) return candidate.effort_profile
}

export function getExpertLanes(value: unknown) {
  const projection = getCoordinatorProjection(value)
  if (projection?.expert_lanes) return projection.expert_lanes
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (isRecord(candidate) && Array.isArray(candidate.expert_lanes) && candidate.expert_lanes.every(isExpertLane))
    return candidate.expert_lanes
}

export function getQualityGates(value: unknown) {
  const projection = getCoordinatorProjection(value)
  if (projection?.quality_gates) return projection.quality_gates
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (isRecord(candidate) && Array.isArray(candidate.quality_gates) && candidate.quality_gates.every(isQualityGate))
    return candidate.quality_gates
}

export function getExpertMemoryContext(value: unknown) {
  const projection = getCoordinatorProjection(value)
  if (projection?.memory_context) return projection.memory_context
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (isRecord(candidate) && isMemoryContext(candidate.memory_context)) return candidate.memory_context
}

export function getTodoTimeline(value: unknown) {
  const projection = getCoordinatorProjection(value)
  if (projection?.todo_timeline) return projection.todo_timeline
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (isRecord(candidate) && isTodoTimeline(candidate.todo_timeline)) return candidate.todo_timeline
}

export function getBudgetState(value: unknown) {
  const projection = getCoordinatorProjection(value)
  if (projection?.budget_state) return projection.budget_state
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (isRecord(candidate) && isBudgetState(candidate.budget_state)) return candidate.budget_state
}

export function getProgressSnapshot(value: unknown) {
  const projection = getCoordinatorProjection(value)
  if (projection?.progress_snapshot) return projection.progress_snapshot
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (isRecord(candidate) && isProgressSnapshot(candidate.progress_snapshot)) return candidate.progress_snapshot
}

export function getContinuationRequest(value: unknown) {
  const projection = getCoordinatorProjection(value)
  if (projection?.continuation_request) return projection.continuation_request
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (isRecord(candidate) && isContinuationRequest(candidate.continuation_request))
    return candidate.continuation_request
}

export function getCheckpointMemorySummary(value: unknown) {
  const projection = getCoordinatorProjection(value)
  if (projection?.checkpoint_memory) return projection.checkpoint_memory
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (isRecord(candidate) && isCheckpointMemorySummary(candidate.checkpoint_memory)) return candidate.checkpoint_memory
}

export function getInboxOverview(value: unknown) {
  const candidate = isRecord(value) && isRecord(value.properties) ? value.properties : value
  if (!isRecord(candidate)) return
  if (!isRecord(candidate.inbox)) return
  if (!isRecord(candidate.wakeups)) return
  if (!isRecord(candidate.memory)) return
  if (typeof candidate.memory.profile !== "number") return
  if (typeof candidate.memory.workspace !== "number") return
  if (typeof candidate.memory.session !== "number") return
  if (!Array.isArray(candidate.memory.recent) || candidate.memory.recent.some((item) => !isRecord(item))) return
  return candidate as InboxOverview
}
