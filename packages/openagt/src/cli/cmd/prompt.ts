// `openagt prompt` — surfaces the v1.21 PromptTemplates A/B telemetry.
// Lists per-variant outcome stats so operators can see which template variant
// is winning the Thompson sampling tournament.

import type { Argv } from "yargs"
import { PromptTemplates } from "../../coordinator/prompt-templates"
import { Database } from "../../storage"
import { Database as BunDatabase } from "bun:sqlite"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { errorMessage } from "../../util/error"
import { EOL } from "os"

const PromptStatsCommand = cmd({
  command: "stats [role]",
  describe: "show per-variant outcome stats for a prompt role (or all roles)",
  builder: (yargs: Argv) =>
    yargs
      .positional("role", {
        type: "string",
        describe: "Prompt role (e.g. 'reviser', 'planner'). If omitted, lists all roles.",
      })
      .option("days", {
        type: "number",
        default: 30,
        describe: "Time window in days",
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"],
        default: "text",
        describe: "Output format",
      }),
  handler: (args: { role?: string; days: number; format: string }) => {
    try {
      const since = Date.now() - args.days * 24 * 60 * 60 * 1000
      const db = new BunDatabase(Database.Path, { readonly: true })
      try {
        const exists = db
          .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='prompt_outcome'`)
          .all()
        if (exists.length === 0) {
          if (args.format === "json") console.log("{}")
          else UI.println("(no prompt_outcome table — no telemetry recorded yet)")
          return
        }

        const roles: string[] = args.role
          ? [args.role]
          : db
              .query<{ role: string }, []>(`SELECT DISTINCT role FROM prompt_outcome ORDER BY role ASC`)
              .all()
              .map((r) => r.role)

        if (roles.length === 0) {
          if (args.format === "json") console.log("{}")
          else UI.println("(no telemetry rows in window)")
          return
        }

        const result: Record<string, ReturnType<typeof PromptTemplates.summarizeVariantHistory>> = {}
        for (const role of roles) {
          const rows = db
            .query<
              { variant: string; success: number; quality: number | null; duration_ms: number | null },
              [string, number]
            >(
              `SELECT variant, success, quality, duration_ms FROM prompt_outcome WHERE role = ? AND time_recorded >= ? ORDER BY time_recorded DESC`,
            )
            .all(role, since)
          result[role] = PromptTemplates.summarizeVariantHistory(rows)
        }

        if (args.format === "json") {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        for (const role of Object.keys(result)) {
          const stats = result[role]
          if (!stats || stats.length === 0) continue
          UI.println(`role: ${role} (window: ${args.days}d)`)
          for (const s of stats) {
            const rate = (s.success_rate * 100).toFixed(1)
            const quality = s.mean_quality !== undefined ? s.mean_quality.toFixed(2) : "—"
            const dur =
              s.mean_duration_ms !== undefined ? `${Math.round(s.mean_duration_ms)}ms` : "—"
            process.stdout.write(
              `  ${s.variant.padEnd(24)} success=${s.success.toString().padStart(4)}/${s.total.toString().padEnd(4)} (${rate.padStart(5)}%)  quality=${quality}  dur=${dur}` +
                EOL,
            )
          }
          UI.println("")
        }
      } finally {
        db.close()
      }
    } catch (err) {
      UI.error(errorMessage(err))
      process.exit(1)
    }
  },
})

export const PromptCommand = cmd({
  command: "prompt",
  describe: "prompt template tools (A/B variant stats)",
  builder: (yargs: Argv) => yargs.command(PromptStatsCommand).demandCommand(),
  handler: () => {},
})
