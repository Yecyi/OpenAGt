// `openagt cal` — surfaces the v1.21 Calibration service. Lists per-expert
// Brier scores and recommended prior adjustments so operators can see whether
// their reviewers are well-calibrated and how the system would tune them.

import type { Argv } from "yargs"
import { AppRuntime } from "@/effect/app-runtime"
import { Calibration } from "../../coordinator/calibration"
import { Database } from "../../storage"
import { Database as BunDatabase } from "bun:sqlite"
import { Instance } from "../../project/instance"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { errorMessage } from "../../util/error"

const CalShowCommand = cmd({
  command: "show [expert_id]",
  describe: "show calibration metrics (Brier score + recommended prior shift) for one or all experts",
  builder: (yargs: Argv) =>
    yargs
      .positional("expert_id", {
        type: "string",
        describe: "Expert ID (e.g. 'coding.synth-reviser'). If omitted, lists all experts with records.",
      })
      .option("since", {
        type: "number",
        describe: "Only consider records since this unix-ms timestamp",
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"],
        default: "text",
        describe: "Output format",
      }),
  async handler(args: { expert_id?: string; since?: number; format: string }) {
    try {
      await Instance.provide({
        directory: process.cwd(),
        async fn() {
          // Discover the set of experts with calibration history. Direct SQL
          // because the Calibration service exposes per-expert reads, not a
          // bulk listing.
          const expertIDs: string[] = args.expert_id
            ? [args.expert_id]
            : await listExpertIdsWithRecords()
          if (expertIDs.length === 0) {
            if (args.format === "json") console.log("[]")
            else UI.println("(no calibration records yet)")
            return
          }

          const rows: Array<{
            expert_id: string
            mean_brier?: number
            sample_size?: number
            grade: string
            shift?: number
          }> = []

          for (const expert_id of expertIDs) {
            const summary = await AppRuntime.runPromise(
              Calibration.Service.use((svc) => svc.meanBrier(expert_id, args.since)),
            )
            const shift = await AppRuntime.runPromise(
              Calibration.Service.use((svc) => svc.recommendPriorAdjustment(expert_id, args.since)),
            )
            rows.push({
              expert_id,
              mean_brier: summary?.mean,
              sample_size: summary?.sample_size,
              grade: summary?.grade ?? "insufficient-data",
              shift: shift?.shift,
            })
          }

          if (args.format === "json") {
            console.log(JSON.stringify(rows, null, 2))
            return
          }
          UI.println(`Calibration summary (${rows.length} expert${rows.length === 1 ? "" : "s"})`)
          UI.println("")
          for (const r of rows) {
            const brier = r.mean_brier !== undefined ? r.mean_brier.toFixed(3) : "—"
            const n = r.sample_size ?? 0
            const shift = r.shift !== undefined ? (r.shift >= 0 ? `+${r.shift.toFixed(3)}` : r.shift.toFixed(3)) : "—"
            UI.println(`${r.expert_id}`)
            UI.println(`  brier=${brier}  n=${n}  grade=${r.grade}  prior_shift=${shift}`)
          }
        },
      })
    } catch (err) {
      UI.error(errorMessage(err))
      process.exit(1)
    }
  },
})

async function listExpertIdsWithRecords(): Promise<string[]> {
  // Read-only SQL bypasses the Effect runtime — same pattern as `db query`.
  try {
    const db = new BunDatabase(Database.Path, { readonly: true })
    try {
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='calibration_record'`)
        .all()
      if (exists.length === 0) return []
      const rows = db
        .query<{ expert_id: string }, []>(`SELECT DISTINCT expert_id FROM calibration_record ORDER BY expert_id ASC`)
        .all()
      return rows.map((r) => r.expert_id)
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

export const CalCommand = cmd({
  command: "cal",
  describe: "calibration tools (Brier score, prior adjustment)",
  builder: (yargs: Argv) => yargs.command(CalShowCommand).demandCommand(),
  handler: () => {},
})
