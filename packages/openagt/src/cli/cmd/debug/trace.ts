import { EOL } from "os"
import path from "path"
import { CoordinatorTraceExport } from "@/coordinator/trace-export"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

function numberValue(value: unknown) {
  if (typeof value === "number") return value
  if (typeof value !== "string") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const TraceCommand = cmd({
  command: "trace",
  describe: "export replayable debug traces",
  builder: (yargs) =>
    yargs
      .command(
        cmd({
          command: "export <session>",
          describe: "export coordinator events as redacted JSONL",
          builder: (inner) =>
            inner
              .positional("session", {
                type: "string",
                describe: "session id to export",
                demandOption: true,
              })
              .option("run", {
                type: "string",
                describe: "optional coordinator run id filter",
              })
              .option("since", {
                type: "number",
                describe: "minimum event timestamp in milliseconds",
              })
              .option("limit", {
                type: "number",
                describe: "maximum events to export",
                default: 10_000,
              })
              .option("output", {
                type: "string",
                describe: "write JSONL to this path instead of stdout",
              }),
          async handler(args) {
            await bootstrap(process.cwd(), async () => {
              const jsonl = CoordinatorTraceExport.exportTraceJsonl({
                sessionID: String(args.session),
                runID: typeof args.run === "string" ? args.run : undefined,
                since: numberValue(args.since),
                limit: numberValue(args.limit),
              })
              if (typeof args.output === "string" && args.output.trim()) {
                const output = path.resolve(args.output)
                await Bun.write(output, jsonl)
                process.stdout.write(`Wrote trace export: ${output}${EOL}`)
                return
              }
              process.stdout.write(jsonl)
            })
          },
        }),
      )
      .demandCommand(),
  async handler() {},
})
