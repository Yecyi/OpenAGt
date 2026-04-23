import { Context, Effect, Fiber, Layer, Queue } from "effect"
import { createWriteStream } from "node:fs"
import { EnvSanitizer } from "@/security/env-sanitizer"
import type { ShellFamily } from "@/security/shell-security"
import type { Tool } from "@/tool"
import * as Truncate from "@/tool/truncate"
import { SandboxBroker } from "@/sandbox/broker"
import type {
  SandboxBackendPreference,
  SandboxEnforcement,
  SandboxFilesystemPolicy,
  SandboxNetworkPolicy,
} from "@/sandbox/types"
import { Log } from "@/util"

const log = Log.create({ service: "shell.runner" })

export type RunInput = {
  shell: string
  shellFamily: ShellFamily
  command: string
  cwd: string
  timeout: number
  description: string
  env?: NodeJS.ProcessEnv
  enforcement: SandboxEnforcement
  backendPreference: SandboxBackendPreference
  filesystemPolicy: SandboxFilesystemPolicy
  allowedPaths: string[]
  writablePaths: string[]
  networkPolicy: SandboxNetworkPolicy
  reportOnly: boolean
  failurePolicy: "closed" | "confirm_downgrade" | "fallback"
  riskLevel?: "safe" | "low" | "medium" | "high"
}

export type RunResult = {
  title: string
  output: string
  metadata: {
    output: string
    exit: number | null
    description: string
    truncated: boolean
    outputPath?: string
    backendPreference: SandboxBackendPreference
    enforcement: SandboxEnforcement
    filesystemPolicy: SandboxFilesystemPolicy
    networkPolicy: SandboxNetworkPolicy
    allowedPaths: string[]
    writablePaths: string[]
    backendUsed?: string
    terminationReason?: string
  }
}

const MAX_METADATA_LENGTH = 30_000

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) return { text, cut: false }
  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const line = lines[i]!
    const size = Buffer.byteLength(line, "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) break
    out.unshift(line)
    bytes += size
  }
  return { text: out.join("\n"), cut: true }
}

function sanitizeEnv(env: NodeJS.ProcessEnv | undefined) {
  const base = Object.fromEntries(
    Object.entries(env ?? process.env).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  )
  return new EnvSanitizer(base).sanitize()
}

export interface Interface {
  readonly run: (input: RunInput, ctx: Tool.Context) => Effect.Effect<RunResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShellRunner") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const broker = yield* SandboxBroker.Service
    const truncate = yield* Truncate.Service
    const run = Effect.fn("ShellRunner.run")(function* (input: RunInput, ctx: Tool.Context) {
      const bytes = Truncate.MAX_BYTES
      const lines = Truncate.MAX_LINES
      const keep = bytes * 2
      let full = ""
      let last = ""
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false
      let backendUsed = ""
      let terminationReason = ""
      let used = 0
      const chunks: Array<{ text: string; size: number }> = []
      const env = sanitizeEnv(input.env)
      const requestID = `${ctx.sessionID}:${ctx.callID || "shell"}:${Date.now()}`
      const capabilities = yield* broker.capabilities()
      const preferred =
        input.backendPreference === "auto"
          ? capabilities.find((item) =>
              process.platform === "darwin"
                ? item.name === "seatbelt"
                : process.platform === "win32"
                  ? item.name === "windows_native"
                  : item.name === "landlock",
            )
          : capabilities.find((item) => item.name === input.backendPreference)

      // B-P0-4: Advisory refusal on medium+ risk when broker absent
      // If enforcement is advisory and no preferred backend is available and risk is medium or high, refuse
      const MEDIUM_RISK_LEVELS = ["medium", "high"]
      if (
        input.enforcement === "advisory" &&
        !preferred?.available &&
        input.riskLevel &&
        MEDIUM_RISK_LEVELS.includes(input.riskLevel)
      ) {
        throw new Error(
          `Command with ${input.riskLevel} risk level cannot be executed in advisory mode when sandbox backend is unavailable. ` +
            `Risk level: ${input.riskLevel}, enforcement: advisory, backend: unavailable`,
        )
      }

      if (input.enforcement === "required" && input.failurePolicy === "closed" && !preferred?.available) {
        throw new Error(preferred?.reason ?? "Required sandbox backend unavailable")
      }

      yield* ctx.metadata({
        metadata: {
          output: "",
          description: input.description,
          backendPreference: input.backendPreference,
          enforcement: input.enforcement,
          filesystemPolicy: input.filesystemPolicy,
          networkPolicy: input.networkPolicy,
          allowedPaths: input.allowedPaths,
          writablePaths: input.writablePaths,
        },
      })

      const updates = yield* Queue.unbounded<string>()
      let metadataClosed = false
      const metadataFiber = Effect.runFork(
        Effect.forever(
          Queue.take(updates).pipe(
            Effect.flatMap((output) =>
              ctx.metadata({
                metadata: {
                  output,
                  description: input.description,
                  backendPreference: input.backendPreference,
                  enforcement: input.enforcement,
                  filesystemPolicy: input.filesystemPolicy,
                  networkPolicy: input.networkPolicy,
                  allowedPaths: input.allowedPaths,
                  writablePaths: input.writablePaths,
                },
              }),
            ),
          ),
        ).pipe(Effect.catch(() => Effect.void)),
      )

      const push = (text: string) => {
        const size = Buffer.byteLength(text, "utf-8")
        chunks.push({ text, size })
        used += size
        while (used > keep && chunks.length > 1) {
          const item = chunks.shift()
          if (!item) break
          used -= item.size
          cut = true
        }
        last = preview(last + text)
        if (!metadataClosed) {
          Effect.runFork(Queue.offer(updates, last).pipe(Effect.asVoid))
        }
        if (file) {
          try {
            sink?.write(text)
          } catch (err) {
            log.error("failed to write to sink", { error: err })
          }
          return
        }
        full += text
      }

      const result = yield* broker.exec({
        request: {
          request_id: requestID,
          command: input.command,
          shell_family: input.shellFamily,
          shell: input.shell,
          cwd: input.cwd,
          timeout_ms: input.timeout,
          description: input.description,
          env,
          env_policy: "sanitize",
          enforcement: input.enforcement,
          backend_preference: input.backendPreference,
          filesystem_policy: input.filesystemPolicy,
          allowed_paths: input.allowedPaths,
          writable_paths: input.writablePaths,
          network_policy: input.networkPolicy,
        },
        abort: ctx.abort,
        onStdout: (text) => {
          push(text)
        },
        onStderr: (text) => {
          push(text)
        },
      })
      const code = result.exit_code
      backendUsed = result.backend_used
      terminationReason = result.termination_reason
      expired = result.termination_reason === "timeout"
      aborted = result.termination_reason === "abort"

      // C-1: Emit sandbox backend_used metric
      log.info("sandbox.backend_used", { backend: result.backend_used })

      const raw = chunks.map((item) => item.text).join("")
      const end = tail(raw, lines, bytes)
      if (end.cut) cut = true
      if (!file && end.cut) file = yield* truncate.write(raw)

      let output = end.text || "(no output)"
      const meta: string[] = []
      if (expired) {
        meta.push(
          `bash tool terminated command after exceeding timeout ${input.timeout} ms, retry with a larger timeout value in milliseconds.`,
        )
      }
      if (aborted) meta.push("User aborted the command")
      if (cut && file) output = `...output truncated...\n\nFull output saved to: ${file}\n\n${output}`
      if (meta.length > 0) output += "\n\n<bash_metadata>\n" + meta.join("\n") + "\n</bash_metadata>"

      if (sink) {
        const stream = sink
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              stream.end(() => resolve())
              stream.on("error", () => resolve())
            }),
        )
      }
      metadataClosed = true
      yield* Queue.shutdown(updates).pipe(Effect.ignore)
      yield* Fiber.await(metadataFiber).pipe(Effect.ignore)

      return {
        title: input.description,
        output,
        metadata: {
          output: last || preview(output),
          exit: code,
          description: input.description,
          truncated: cut,
          ...(cut && file ? { outputPath: file } : {}),
          backendPreference: input.backendPreference,
          enforcement: input.enforcement,
          filesystemPolicy: input.filesystemPolicy,
          networkPolicy: input.networkPolicy,
          allowedPaths: input.allowedPaths,
          writablePaths: input.writablePaths,
          backendUsed,
          terminationReason,
        },
      }
    })

    return Service.of({ run })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Truncate.defaultLayer), Layer.provide(SandboxBroker.defaultLayer))

export * as ShellRunner from "./runner"
