// `openagt mem` — memory consolidation control. Manually trigger a B.3
// consolidation pass (encode → pattern → decay) with optional config knobs.

import type { Argv } from "yargs"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "../../project/instance"
import { MemoryConsolidator } from "../../personal/consolidator"
import type { ConsolidatorConfig } from "../../personal/consolidator"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { errorMessage } from "../../util/error"

const MemConsolidateCommand = cmd({
  command: "consolidate",
  describe: "run a memory consolidation pass (extract semantic facts from recent episodic notes)",
  builder: (yargs: Argv) =>
    yargs
      .option("min-occurrences", {
        type: "number",
        describe: "Minimum repeat count for a triple to become a semantic fact (default: 3)",
      })
      .option("max-facts", {
        type: "number",
        describe: "Cap on facts emitted per run (default: 50)",
      })
      .option("replay-window-hours", {
        type: "number",
        describe: "How far back to scan episodic notes (default: 168h / 1 week)",
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"],
        default: "text",
        describe: "Output format",
      }),
  async handler(args: {
    "min-occurrences"?: number
    "max-facts"?: number
    "replay-window-hours"?: number
    format: string
  }) {
    try {
      await Instance.provide({
        directory: process.cwd(),
        async fn() {
          const overrides: Partial<ConsolidatorConfig> = {
            ...(args["min-occurrences"] !== undefined ? { min_pattern_occurrences: args["min-occurrences"] } : {}),
            ...(args["max-facts"] !== undefined ? { max_facts_per_run: args["max-facts"] } : {}),
            ...(args["replay-window-hours"] !== undefined
              ? { replay_window_hours: args["replay-window-hours"] }
              : {}),
          }
          const report = await AppRuntime.runPromise(
            MemoryConsolidator.Service.use((svc) => svc.runOnce(overrides)),
          )
          if (args.format === "json") {
            console.log(JSON.stringify(report, null, 2))
            return
          }
          if (report.skipped_lock_held) {
            UI.println("consolidator skipped — another process holds the lock")
            return
          }
          UI.println(`consolidator finished:`)
          UI.println(`  encoded:  ${report.encoded} new semantic facts`)
          UI.println(`  patterns: ${report.patterns} candidates above min-occurrences threshold`)
          UI.println(`  replayed: ${report.replayed}`)
          UI.println(`  decayed:  ${report.decayed} facts would be demoted/deleted`)
        },
      })
    } catch (err) {
      UI.error(errorMessage(err))
      process.exit(1)
    }
  },
})

export const MemCommand = cmd({
  command: "mem",
  describe: "memory layer tools (consolidator, semantic facts, procedural recipes)",
  builder: (yargs: Argv) => yargs.command(MemConsolidateCommand).demandCommand(),
  handler: () => {},
})
