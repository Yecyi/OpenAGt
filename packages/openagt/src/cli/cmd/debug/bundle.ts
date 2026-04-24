import { EOL } from "os"
import path from "path"
import { Effect } from "effect"
import { Config } from "../../../config"
import { Global } from "../../../global"
import { Session } from "../../../session"
import { SessionID } from "../../../session/schema"
import { AppRuntime } from "@/effect/app-runtime"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    if (/key|token|secret|password|authorization/i.test(value)) return "[redacted]"
    return value.length > 240 ? `${value.slice(0, 240)}...[truncated]` : value
  }
  if (Array.isArray(value)) return value.map(redact)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /key|token|secret|password|authorization/i.test(key) ? "[redacted]" : redact(item),
    ]),
  )
}

export const BundleCommand = cmd({
  command: "bundle",
  describe: "export a sanitized debug bundle",
  builder: (yargs) =>
    yargs
      .option("session", {
        type: "string",
        demandOption: true,
        describe: "session id to include",
      })
      .option("output", {
        type: "string",
        describe: "output JSON path",
      })
      .option("include-content", {
        type: "boolean",
        describe: "include redacted message content summaries",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.session as string)
      const bundle = await AppRuntime.runPromise(
        Session.Service.use((sessions) =>
          Config.Service.use((cfg) =>
            sessions.get(sessionID).pipe(
              Effect.flatMap((session) =>
                Effect.all({
                  config: cfg.get(),
                  messages: sessions.messages({ sessionID, limit: 100 }),
                }).pipe(
                  Effect.map((result) => ({
                    schema_version: 1,
                    generated_at: new Date().toISOString(),
                    paths: {
                      config: Global.Path.config,
                      state: Global.Path.state,
                      worktree: process.cwd(),
                    },
                    session: {
                      id: session.id,
                      title: session.title,
                      parentID: session.parentID,
                      projectID: session.projectID,
                    },
                    config_summary: {
                      provider_count: Object.keys((result.config.provider ?? {}) as Record<string, unknown>).length,
                      mcp_count: Object.keys((result.config.mcp ?? {}) as Record<string, unknown>).length,
                      sandbox: result.config.experimental?.sandbox,
                    },
                    messages: result.messages.map((message) => ({
                      id: message.info.id,
                      role: message.info.role,
                      time: message.info.time,
                      part_count: message.parts.length,
                      parts: args.includeContent
                        ? message.parts.map((part) => redact(part))
                        : message.parts.map((part) => ({ type: part.type })),
                    })),
                  })),
                ),
              ),
            ),
          ),
        ),
      )
      const output = args.output
        ? path.resolve(args.output as string)
        : path.resolve(process.cwd(), `openagt-debug-bundle-${sessionID}.json`)
      await Bun.write(output, JSON.stringify(redact(bundle), null, 2) + EOL)
      process.stdout.write(`Wrote debug bundle: ${output}${EOL}`)
    })
  },
})
