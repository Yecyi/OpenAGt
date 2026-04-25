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
  return candidate as CoordinatorProjection
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
