import { Context, Effect, Fiber, Layer, Queue } from "effect"
import { EnvSanitizer } from "@/security/env-sanitizer"
import type { ShellFamily } from "@/security/shell-security"
import type { Tool } from "@/tool"
import * as Truncate from "@/tool/truncate"
import { SandboxBroker } from "@/sandbox/broker"
import { autoBackendName } from "@/sandbox/backends"
import type {
  SandboxBackendPreference,
  SandboxEnforcement,
  SandboxFilesystemPolicy,
  SandboxNetworkPolicy,
} from "@/sandbox/types"
import { Log } from "@/util"
import { ShellOutputBuffer } from "./output-buffer"

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
      let expired = false
      let aborted = false
      let backendUsed = ""
      let terminationReason = ""
      const output = new ShellOutputBuffer({ bytes, lines, keep })
      const env = sanitizeEnv(input.env)
      const requestID = `${ctx.sessionID}:${ctx.callID || "shell"}:${Date.now()}`
      const capabilities = yield* broker.capabilities()
      const preferred =
        input.backendPreference === "auto"
          ? capabilities.find((item) => item.name === autoBackendName())
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

      if (
        input.enforcement === "required" &&
        input.failurePolicy === "closed" &&
        input.backendPreference !== "auto" &&
        !preferred?.available
      ) {
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

      const updates = yield* Queue.sliding<string>(1)
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
        ).pipe(Effect.catchCause(() => Effect.void)),
      )

      const push = (text: string) => {
        output.push(text, (preview) => {
          if (!metadataClosed) Queue.offerUnsafe(updates, preview)
        })
      }

      const cleanupMetadata = Effect.gen(function* () {
        metadataClosed = true
        yield* Queue.shutdown(updates).pipe(Effect.ignore)
        yield* Fiber.interrupt(metadataFiber).pipe(Effect.ignore)
      })

      return yield* Effect.gen(function* () {
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
            failure_policy: input.failurePolicy,
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

        const formatted = yield* output.format({
          expired,
          aborted,
          timeout: input.timeout,
          writeFullOutput: (text) => truncate.write(text),
        })

        if (formatted.latest) {
          yield* ctx.metadata({
            metadata: {
              output: formatted.latest,
              description: input.description,
              backendPreference: input.backendPreference,
              enforcement: input.enforcement,
              filesystemPolicy: input.filesystemPolicy,
              networkPolicy: input.networkPolicy,
              allowedPaths: input.allowedPaths,
              writablePaths: input.writablePaths,
            },
          })
        }

        return {
          title: input.description,
          output: formatted.output,
          metadata: {
            output: formatted.metadataOutput,
            exit: code,
            description: input.description,
            truncated: formatted.truncated,
            ...(formatted.outputPath ? { outputPath: formatted.outputPath } : {}),
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
      }).pipe(Effect.ensuring(cleanupMetadata))
    })

    return Service.of({ run })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Truncate.defaultLayer), Layer.provide(SandboxBroker.defaultLayer))

export * as ShellRunner from "./runner"
