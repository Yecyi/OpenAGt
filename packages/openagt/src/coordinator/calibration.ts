export * as Calibration from "./calibration"

// Calibration service — A.4 of the v1.21 plan.
//
// Records reviewer/critic posterior vs. observed outcome pairs and exposes
// Brier-score aggregates. Brier is precomputed at insert time so historical
// queries are cheap. The service intentionally provides only RAW data; the
// MPACR synthesis prompt (A.5+) decides how to weight critics by their
// historical Brier.

import { Context, Effect, Layer } from "effect"
import { and, asc, eq, gte, sql } from "drizzle-orm"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Database, desc } from "@/storage"
import { Identifier } from "@/id/id"
import { Log } from "../util"
import z from "zod"
import { CalibrationRecordTable } from "./calibration.sql"

const log = Log.create({ service: "calibration" })

export const CalibrationRecordID = Identifier.schema("calibration")
export type CalibrationRecordID = z.infer<typeof CalibrationRecordID>

export const CalibrationRecord = z.object({
  id: z.string(),
  expert_id: z.string(),
  workflow: z.string(),
  prior: z.number().min(0).max(1),
  posterior: z.number().min(0).max(1),
  outcome: z.number().min(0).max(1),
  brier: z.number().min(0).max(1),
  time_recorded: z.number().int(),
})
export type CalibrationRecord = z.infer<typeof CalibrationRecord>

// Minimum sample size before meanBrier and recommendPriorAdjustment return
// values. Below this threshold we don't trust the estimate. Mirrors the
// threshold called out in the plan (§A.4 of OpenAGt-Improvement-Design.md).
export const MIN_CALIBRATION_SAMPLES = 20

// Quality bands for surfacing in the UI.
export type CalibrationGrade = "well-calibrated" | "acceptable" | "poor" | "insufficient-data"

export function gradeBrier(brier: number, sampleSize: number): CalibrationGrade {
  if (sampleSize < MIN_CALIBRATION_SAMPLES) return "insufficient-data"
  if (brier <= 0.10) return "well-calibrated"
  if (brier <= 0.25) return "acceptable"
  return "poor"
}

// Pure helper: classic Brier score on a single observation.
// outcome and posterior are both in [0,1]. Result in [0,1] (lower = better).
export function computeBrier(posterior: number, outcome: number): number {
  const p = clamp01(posterior)
  const o = clamp01(outcome)
  return (p - o) * (p - o)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

// Pure helper: compute prior-adjustment recommendation from sample observations.
// Returns the average (outcome - prior) clamped to [-0.1, +0.1] so we never
// shift a prior by more than 10 percentage points per recalibration. Returns
// undefined if the sample is below MIN_CALIBRATION_SAMPLES.
export function recommendPriorShift(
  samples: readonly { prior: number; outcome: number }[],
): { shift: number; sample_size: number } | undefined {
  if (samples.length < MIN_CALIBRATION_SAMPLES) return undefined
  const totalDiff = samples.reduce((acc, s) => acc + (clamp01(s.outcome) - clamp01(s.prior)), 0)
  const mean = totalDiff / samples.length
  const shift = Math.max(-0.1, Math.min(0.1, mean))
  return { shift, sample_size: samples.length }
}

export interface RecordInput {
  readonly expert_id: string
  readonly workflow: string
  readonly prior: number
  readonly posterior: number
  readonly outcome: number
  readonly time_recorded?: number
}

export interface MeanBrierResult {
  readonly mean: number
  readonly sample_size: number
  readonly grade: CalibrationGrade
}

export interface Interface {
  readonly record: (input: RecordInput) => Effect.Effect<CalibrationRecord, Error>
  // Returns mean Brier over an optional time window. `since` is a unix ms
  // cutoff; rows older than this are excluded. Returns undefined if the
  // sample size is below MIN_CALIBRATION_SAMPLES.
  readonly meanBrier: (expertID: string, since?: number) => Effect.Effect<MeanBrierResult | undefined, Error>
  // Suggested prior offset for this expert based on history. Returns
  // undefined under MIN_CALIBRATION_SAMPLES.
  readonly recommendPriorAdjustment: (
    expertID: string,
    since?: number,
  ) => Effect.Effect<{ shift: number; sample_size: number } | undefined, Error>
  // Lists raw records, mostly for the `openagt cal show` CLI.
  readonly listRecords: (input: { expert_id: string; since?: number; limit?: number }) => Effect.Effect<
    CalibrationRecord[],
    Error
  >
}

export const Event = {
  CalibrationRecorded: BusEvent.define("calibration.recorded", CalibrationRecord),
}

export class Service extends Context.Service<Service, Interface>()("@openagt/Calibration") {}

function rowToRecord(row: typeof CalibrationRecordTable.$inferSelect): CalibrationRecord {
  return {
    id: row.id,
    expert_id: row.expert_id,
    workflow: row.workflow,
    prior: row.prior,
    posterior: row.posterior,
    outcome: row.outcome,
    brier: row.brier,
    time_recorded: row.time_recorded,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const record: Interface["record"] = Effect.fn("Calibration.record")(function* (input) {
      const id = Identifier.ascending("calibration") as CalibrationRecordID
      const ts = input.time_recorded ?? Date.now()
      const brier = computeBrier(input.posterior, input.outcome)
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(CalibrationRecordTable)
            .values({
              id,
              expert_id: input.expert_id,
              workflow: input.workflow,
              prior: clamp01(input.prior),
              posterior: clamp01(input.posterior),
              outcome: clamp01(input.outcome),
              brier,
              time_recorded: ts,
              time_created: ts,
              time_updated: ts,
            })
            .run(),
        ),
      )
      const row = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(CalibrationRecordTable).where(eq(CalibrationRecordTable.id, id)).get(),
        ),
      )
      if (!row) return yield* Effect.fail(new Error(`calibration record ${id} not found after insert`))
      const rec = rowToRecord(row)
      yield* bus.publish(Event.CalibrationRecorded, rec)
      return rec
    })

    const meanBrier: Interface["meanBrier"] = Effect.fn("Calibration.meanBrier")(function* (expertID, since) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => {
          const where =
            since !== undefined
              ? and(eq(CalibrationRecordTable.expert_id, expertID), gte(CalibrationRecordTable.time_recorded, since))
              : eq(CalibrationRecordTable.expert_id, expertID)
          return db
            .select({
              mean: sql<number>`AVG(${CalibrationRecordTable.brier})`,
              count: sql<number>`COUNT(${CalibrationRecordTable.id})`,
            })
            .from(CalibrationRecordTable)
            .where(where)
            .get()
        }),
      )
      if (!row) return undefined
      const sample_size = Number(row.count ?? 0)
      if (sample_size < MIN_CALIBRATION_SAMPLES) return undefined
      const mean = Number(row.mean ?? 0)
      return { mean, sample_size, grade: gradeBrier(mean, sample_size) }
    })

    const recommendPriorAdjustment: Interface["recommendPriorAdjustment"] = Effect.fn(
      "Calibration.recommendPriorAdjustment",
    )(function* (expertID, since) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => {
          const where =
            since !== undefined
              ? and(eq(CalibrationRecordTable.expert_id, expertID), gte(CalibrationRecordTable.time_recorded, since))
              : eq(CalibrationRecordTable.expert_id, expertID)
          return db
            .select({ prior: CalibrationRecordTable.prior, outcome: CalibrationRecordTable.outcome })
            .from(CalibrationRecordTable)
            .where(where)
            .all()
        }),
      )
      return recommendPriorShift(rows)
    })

    const listRecords: Interface["listRecords"] = Effect.fn("Calibration.listRecords")(function* (input) {
      const limit = input.limit ?? 100
      const rows = yield* Effect.sync(() =>
        Database.use((db) => {
          const where =
            input.since !== undefined
              ? and(
                  eq(CalibrationRecordTable.expert_id, input.expert_id),
                  gte(CalibrationRecordTable.time_recorded, input.since),
                )
              : eq(CalibrationRecordTable.expert_id, input.expert_id)
          return db
            .select()
            .from(CalibrationRecordTable)
            .where(where)
            .orderBy(desc(CalibrationRecordTable.time_recorded))
            .limit(limit)
            .all()
        }),
      )
      return rows.map(rowToRecord)
    })

    return Service.of({ record, meanBrier, recommendPriorAdjustment, listRecords })
  }),
)

// Provides Bus so the layer can publish CalibrationRecorded events.
export const defaultLayer = layer.pipe(Layer.provide(Bus.defaultLayer))
