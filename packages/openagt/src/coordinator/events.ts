export * as CoordinatorEvents from "./events"

import { createHash } from "crypto"
import { Cause, Effect } from "effect"
import { Database } from "@/storage"
import { Identifier } from "@/id/id"
import { Log } from "@/util"
import { CoordinatorEventTable } from "./coordinator-events.sql"
import type { CoordinatorRunID } from "./schema"
import type { SessionID } from "@/session/schema"

const log = Log.create({ service: "coordinator.events" })
const schemaVersion = 1
const flushDelayMs = 200
const maxBatchSize = 256

export const EventKinds = [
  "task_dispatched",
  "task_finished",
  "review_verdict",
  "revise_triggered",
  "continuation_decision",
  "budget_breach",
  "compaction_layer",
  "tool_call",
] as const

export type EventKind = (typeof EventKinds)[number]

export type EmitInput = {
  session_id: string
  run_id?: string
  task_id?: string
  expert_id?: string
  workflow?: string
  effort?: string
  event_kind: EventKind
  payload: Record<string, unknown>
  ts?: number
}

type PendingEvent = typeof CoordinatorEventTable.$inferInsert

const queue: PendingEvent[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  )
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function row(input: EmitInput): PendingEvent {
  const ts = input.ts ?? Date.now()
  const payload = canonical(input.payload) as Record<string, unknown>
  return {
    event_id: Identifier.ascending("event"),
    ts,
    session_id: input.session_id as SessionID,
    run_id: input.run_id as CoordinatorRunID | undefined,
    task_id: input.task_id,
    expert_id: input.expert_id,
    workflow: input.workflow,
    effort: input.effort,
    event_kind: input.event_kind,
    payload_json: payload,
    schema_version: schemaVersion,
    idempotency_key: hash({
      session_id: input.session_id,
      run_id: input.run_id,
      task_id: input.task_id,
      event_kind: input.event_kind,
      payload,
    }),
    time_created: ts,
    time_updated: ts,
  }
}

function scheduleFlush() {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    Effect.runFork(
      flush().pipe(Effect.catchCause((cause) => Effect.sync(() => log.warn("flush failed", { cause: Cause.pretty(cause) })))),
    )
  }, flushDelayMs)
  timer.unref?.()
}

function takeBatch() {
  return queue.splice(0, maxBatchSize)
}

export function emit(input: EmitInput): Effect.Effect<void> {
  return Effect.sync(() => {
    queue.push(row(input))
    scheduleFlush()
  })
}

export function flushSync() {
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
  while (queue.length > 0) {
    const batch = takeBatch()
    Database.transaction((db) => db.insert(CoordinatorEventTable).values(batch).onConflictDoNothing().run())
  }
}

export function flush(): Effect.Effect<void, Error> {
  return Effect.sync(flushSync)
}
