import { EOL } from "os"
import path from "path"
import { Config } from "../../../config"
import { Global } from "../../../global"
import { Shell } from "../../../shell/shell"
import { AppRuntime } from "@/effect/app-runtime"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

type DoctorStatus = "ok" | "warn" | "fail"

type DoctorCheck = {
  name: string
  status: DoctorStatus
  summary: string
  details?: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function status(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((item) => item.status === "fail")) return "fail"
  if (checks.some((item) => item.status === "warn")) return "warn"
  return "ok"
}

function text(report: { status: DoctorStatus; checks: DoctorCheck[] }) {
  return [
    `OpenAGt doctor: ${report.status}`,
    ...report.checks.map((item) => {
      const details = item.details ? ` ${JSON.stringify(item.details)}` : ""
      return `- ${item.status.toUpperCase()} ${item.name}: ${item.summary}${details}`
    }),
  ].join(EOL)
}

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "run environment and runtime diagnostics",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      describe: "print machine-readable JSON",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get()))
      const sandbox = record(record(config.experimental).sandbox)
      const shell = Shell.acceptable()
      const binDir = path.dirname(process.execPath)
      const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
      const checks: DoctorCheck[] = [
        {
          name: "config",
          status: "ok",
          summary: "configuration loaded",
          details: {
            config: Global.Path.config,
            state: Global.Path.state,
            providers: Object.keys(record(config.provider)).length,
            mcp: Object.keys(record(config.mcp)).length,
          },
        },
        {
          name: "shell",
          status: shell ? "ok" : "fail",
          summary: shell ? `default shell resolved to ${Shell.name(shell)}` : "no acceptable shell found",
          details: { shell },
        },
        {
          name: "sandbox",
          status: sandbox.enabled === false ? "warn" : "ok",
          summary: sandbox.enabled === false ? "sandbox disabled by config" : "sandbox configuration available",
          details: {
            config: sandbox,
            backend: sandbox.backend ?? "auto",
            failure_policy: sandbox.failure_policy ?? "fallback",
            report_only: sandbox.report_only ?? false,
          },
        },
        {
          name: "release-install",
          status: pathEntries.some((item) => item.toLowerCase() === binDir.toLowerCase()) ? "ok" : "warn",
          summary: pathEntries.some((item) => item.toLowerCase() === binDir.toLowerCase())
            ? "current executable directory is on PATH"
            : "current executable directory is not on PATH",
          details: {
            execPath: process.execPath,
            binDir,
          },
        },
      ]
      const report = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        status: status(checks),
        checks,
      }
      process.stdout.write((args.json ? JSON.stringify(report, null, 2) : text(report)) + EOL)
    })
  },
})
