function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isCoordinatorGroup(value: unknown): value is CoordinatorProjectionGroup {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (!isStringArray(value.node_ids)) return false
  if (!isStringArray(value.task_ids)) return false
  if (!["pending", "running", "completed", "failed", "cancelled"].includes(String(value.status))) return false
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

export type CoordinatorProjectionGroup = Record<string, unknown> & {
  id: string
  node_ids: string[]
  task_ids: string[]
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
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
  if (!Array.isArray(candidate.groups) || candidate.groups.some((item) => !isCoordinatorGroup(item))) return
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
  return candidate as CoordinatorProjection
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
