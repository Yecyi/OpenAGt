import { Context, Effect, Fiber, Layer } from "effect"
import * as Stream from "effect/Stream"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { createWriteStream } from "node:fs"
import { EnvSanitizer } from "@/security/env-sanitizer"
import type { NetworkAccess, SandboxMode, ShellFamily } from "@/security/shell-security"
import type { Tool } from "@/tool"
import * as Truncate from "@/tool/truncate"
import { Shell } from "./shell"

export type RunInput = {
  shell: string
  shellFamily: ShellFamily
  command: string
  cwd: string
  timeout: number
  description: string
  env?: NodeJS.ProcessEnv
  sandboxMode: SandboxMode
  filesystemScope: string[]
  networkAccess: NetworkAccess
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
    sandboxMode: SandboxMode
    networkAccess: NetworkAccess
    filesystemScope: string[]
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

function makeProcess(input: RunInput, env: NodeJS.ProcessEnv) {
  const name = Shell.name(input.shell)
  if (process.platform === "win32" && (name === "powershell" || name === "pwsh")) {
    return ChildProcess.make(input.shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", input.command], {
      cwd: input.cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(input.command, [], {
    shell: input.shell,
    cwd: input.cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}

export interface Interface {
  readonly run: (input: RunInput, ctx: Tool.Context) => Effect.Effect<RunResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShellRunner") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
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
      let used = 0
      const chunks: Array<{ text: string; size: number }> = []
      const env = sanitizeEnv(input.env)

      yield* ctx.metadata({
        metadata: {
          output: "",
          description: input.description,
          sandboxMode: input.sandboxMode,
          networkAccess: input.networkAccess,
          filesystemScope: input.filesystemScope,
        },
      })

      const code = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(makeProcess(input, env))
          const pump = yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (text) => {
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
              if (file) {
                sink?.write(text)
              } else {
                full += text
                if (Buffer.byteLength(full, "utf-8") > bytes) {
                  return truncate.write(full).pipe(
                    Effect.andThen((next) =>
                      Effect.sync(() => {
                        file = next
                        sink = createWriteStream(next, { flags: "a" })
                        full = ""
                        cut = true
                      }),
                    ),
                  )
                }
              }

              return ctx.metadata({
                metadata: {
                  output: last,
                  description: input.description,
                  sandboxMode: input.sandboxMode,
                  networkAccess: input.networkAccess,
                  filesystemScope: input.filesystemScope,
                },
              })
            }),
          )

          const abort = Effect.callback<void>((resume) => {
            if (ctx.abort.aborted) return resume(Effect.void)
            const handler = () => resume(Effect.void)
            ctx.abort.addEventListener("abort", handler, { once: true })
            return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
          })
          const timeout = Effect.sleep(`${input.timeout + 100} millis`)
          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((result) => ({ kind: "exit" as const, code: result }))),
            abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
            timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
          ])

          if (exit.kind === "abort") {
            aborted = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          if (exit.kind === "timeout") {
            expired = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }

          yield* Fiber.join(pump).pipe(Effect.catchAllCause(() => Effect.void))
          return exit.kind === "exit" ? exit.code : null
        }),
      ).pipe(Effect.orDie)

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

      return {
        title: input.description,
        output,
        metadata: {
          output: last || preview(output),
          exit: code,
          description: input.description,
          truncated: cut,
          ...(cut && file ? { outputPath: file } : {}),
          sandboxMode: input.sandboxMode,
          networkAccess: input.networkAccess,
          filesystemScope: input.filesystemScope,
        },
      }
    })

    return Service.of({ run })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Truncate.defaultLayer))

export * as ShellRunner from "./runner"
