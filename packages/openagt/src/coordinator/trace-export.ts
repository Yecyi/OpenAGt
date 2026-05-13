export * as CoordinatorTraceExport from "./trace-export"

import { CoordinatorEvents } from "./events"
import { Database } from "@/storage"

type TraceRow = {
  event_id: string
  ts: number
  session_id: string
  run_id: string | null
  task_id: string | null
  expert_id: string | null
  workflow: string | null
  effort: string | null
  event_kind: string
  payload_json: string | Record<string, unknown>
  schema_version: number
}

export type TraceExportInput = {
  sessionID: string
  runID?: string
  since?: number
  limit?: number
  now?: number
}

export type TraceExportLine = {
  schema_version: 1
  exported_at: string
  event: {
    event_id: string
    ts: number
    session_id: string
    run_id?: string
    task_id?: string
    expert_id?: string
    workflow?: string
    effort?: string
    event_kind: string
    payload: unknown
    source_schema_version: number
  }
}

const sensitiveKey =
  /(^|_|\b)(api[_-]?key|auth|authorization|bearer|client[_-]?secret|cookie|credential|password|refresh[_-]?token|secret|token)(_|$|\b)/i
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g
const authContentPattern = /\b(?:OPENAGT_AUTH_CONTENT|OPENCODE_AUTH_CONTENT)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/g
const keyPattern = /\b(?:sk|pk|ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_=-]{8,}\b/g

function redactString(value: string) {
  return value
    .replaceAll(bearerPattern, "Bearer [redacted]")
    .replaceAll(authContentPattern, "$1=[redacted]")
    .replaceAll(keyPattern, "[redacted:key]")
}

export function redactTraceValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > 16) return "[redacted:depth]"
  if (sensitiveKey.test(key)) return value === "" ? value : `[redacted:${key || "secret"}]`
  if (typeof value === "string") return redactString(value)
  if (Array.isArray(value)) return value.map((item) => redactTraceValue(item, key, depth + 1))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, item]) => [entryKey, redactTraceValue(item, entryKey, depth + 1)]),
  )
}

function rows(input: TraceExportInput) {
  CoordinatorEvents.flushSync()
  const limit = Math.min(Math.max(input.limit ?? 10_000, 1), 100_000)
  const sqlite = Database.Client().$client
  if (input.runID) {
    return sqlite
      .query<TraceRow, [string, string, number, number]>(
        `
        SELECT event_id, ts, session_id, run_id, task_id, expert_id, workflow, effort, event_kind, payload_json, schema_version
        FROM coordinator_event
        WHERE session_id = ? AND run_id = ? AND ts >= ?
        ORDER BY ts ASC, event_id ASC
        LIMIT ?
        `,
      )
      .all(input.sessionID, input.runID, input.since ?? 0, limit)
  }
  return sqlite
    .query<TraceRow, [string, number, number]>(
      `
      SELECT event_id, ts, session_id, run_id, task_id, expert_id, workflow, effort, event_kind, payload_json, schema_version
      FROM coordinator_event
      WHERE session_id = ? AND ts >= ?
      ORDER BY ts ASC, event_id ASC
      LIMIT ?
      `,
    )
    .all(input.sessionID, input.since ?? 0, limit)
}

function payload(value: TraceRow["payload_json"]) {
  if (typeof value !== "string") return value
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === "object" && parsed !== null ? parsed : value
  } catch {
    return value
  }
}

export function exportTraceLines(input: TraceExportInput): TraceExportLine[] {
  const exported_at = new Date(input.now ?? Date.now()).toISOString()
  return rows(input).map((row) => ({
    schema_version: 1,
    exported_at,
    event: {
      event_id: row.event_id,
      ts: row.ts,
      session_id: row.session_id,
      ...(row.run_id ? { run_id: row.run_id } : {}),
      ...(row.task_id ? { task_id: row.task_id } : {}),
      ...(row.expert_id ? { expert_id: row.expert_id } : {}),
      ...(row.workflow ? { workflow: row.workflow } : {}),
      ...(row.effort ? { effort: row.effort } : {}),
      event_kind: row.event_kind,
      payload: redactTraceValue(payload(row.payload_json)),
      source_schema_version: row.schema_version,
    },
  }))
}

export function exportTraceJsonl(input: TraceExportInput) {
  const lines = exportTraceLines(input).map((line) => JSON.stringify(line))
  return lines.length ? `${lines.join("\n")}\n` : ""
}
