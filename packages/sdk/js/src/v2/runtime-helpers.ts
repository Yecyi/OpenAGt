function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export type CoordinatorProjection = {
  run: Record<string, unknown>
  tasks: Record<string, unknown>[]
  counts: Record<string, number>
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
