import { EOL } from "os"
import { CoordinatorDebugStats, type DebugStats } from "@/coordinator/debug-stats"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

const durationPattern = /^(\d+)(ms|s|m|h|d)?$/

function parseWindow(value: string | undefined) {
  if (!value) return 7 * 24 * 60 * 60 * 1000
  const match = durationPattern.exec(value.trim())
  if (!match) throw new Error(`Invalid window duration: ${value}`)
  const amount = Number(match[1])
  const unit = match[2] ?? "ms"
  if (unit === "d") return amount * 24 * 60 * 60 * 1000
  if (unit === "h") return amount * 60 * 60 * 1000
  if (unit === "m") return amount * 60 * 1000
  if (unit === "s") return amount * 1000
  return amount
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

function lines(report: DebugStats, windowLabel: string) {
  return [
    `OpenAGt coordinator stats: ${windowLabel}`,
    "",
    "Task success rate",
    ...(report.task_success_rate.length === 0
      ? ["- no task_finished events in window"]
      : report.task_success_rate.map(
          (item) => `- ${item.workflow}/${item.expert_id}: ${pct(item.success_rate)} (n=${item.total})`,
        )),
    "",
    "Revise loop depth",
    ...(report.revise_loop_depth.length === 0
      ? ["- no revise_triggered events in window"]
      : report.revise_loop_depth.map((item) => `- ${item.workflow}: p50=${item.p50}, p95=${item.p95} (n=${item.samples})`)),
    "",
    "Continuation outcome",
    ...(report.continuation_outcome.length === 0
      ? ["- no continuation_decision events in window"]
      : report.continuation_outcome.map(
          (item) => `- ${item.reason}: ${pct(item.progress_rate)} progress (n=${item.total})`,
        )),
    "",
    "Budget efficiency",
    ...(report.budget_efficiency.length === 0
      ? ["- no budget_breach events in window"]
      : report.budget_efficiency.map(
          (item) => `- ${item.workflow}/${item.effort}: ${item.efficiency.toFixed(3)} (n=${item.samples})`,
        )),
    "",
    "Sandbox downgrades",
    ...(report.sandbox_downgrade_count.length === 0
      ? ["- no sandbox downgrade events in window"]
      : report.sandbox_downgrade_count.map((item) => `- ${item.reason}: n=${item.total}`)),
    "",
    "Native sandbox readiness",
    ...(report.native_sandbox_readiness.length === 0
      ? ["- no native sandbox readiness events in window"]
      : report.native_sandbox_readiness.map((item) => `- ${item.readiness}: n=${item.total}`)),
    "",
    "Memory sink metrics",
    ...(report.memory_sink_metrics.length === 0
      ? ["- no expert/verifier/reviser/reducer memory in window"]
      : report.memory_sink_metrics.map(
          (item) => `- ${item.source}: n=${item.total}, failure_patterns=${item.failure_patterns}`,
        )),
  ].join(EOL)
}

export const StatsCommand = cmd({
  command: "stats",
  describe: "print coordinator telemetry metrics",
  builder: (yargs) =>
    yargs
      .option("window", {
        type: "string",
        describe: "time window, e.g. 7d, 24h, 30m",
        default: "7d",
      })
      .option("json", {
        type: "boolean",
        describe: "print machine-readable JSON",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const report = CoordinatorDebugStats.stats(parseWindow(args.window))
      process.stdout.write((args.json ? JSON.stringify(report, null, 2) : lines(report, args.window)) + EOL)
    })
  },
})
