import { Context, Effect, Layer } from "effect"
import { fileURLToPath } from "url"
import { createFrameParser, encodeFrame } from "./protocol"
import {
  SANDBOX_PROTOCOL_VERSION,
  type SandboxBackendStatus,
  type SandboxExecRequest,
  type SandboxExecResult,
} from "./types"
import { OPENCODE_PROCESS_ROLE, OPENCODE_RUN_ID, ensureRunID, sanitizedProcessEnv } from "@/util/opencode-process"

type Pending = {
  onStdout: (chunk: string) => void
  onStderr: (chunk: string) => void
  resolve: (result: SandboxExecResult) => void
  reject: (error: Error) => void
}

export interface Interface {
  readonly capabilities: () => Effect.Effect<SandboxBackendStatus[]>
  readonly exec: (input: {
    request: SandboxExecRequest
    onStdout: (chunk: string) => void
    onStderr: (chunk: string) => void
    abort?: AbortSignal
  }) => Effect.Effect<SandboxExecResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SandboxBroker") {}

export function brokerCommand(argv = process.argv, execPath = process.execPath, execArgv = process.execArgv) {
  const script = argv[1]
  const sourceBroker = fileURLToPath(new URL("./broker-main.ts", import.meta.url))
  if (execPath.toLowerCase().includes("bun") && (!script || script === "test")) return [execPath, sourceBroker]
  if (execPath.toLowerCase().includes("bun") && script && /\.test\.[cm]?[jt]sx?$/i.test(script)) {
    return [execPath, sourceBroker]
  }
  if (!script) return [execPath]
  if (!/\.(?:[cm]?[jt]s|tsx?|jsx?)$/i.test(script)) return [execPath]
  if (execPath.toLowerCase().includes("bun")) return [execPath, ...execArgv, sourceBroker]
  return [execPath, ...execArgv, script]
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const proc = Bun.spawn({
      cmd: brokerCommand(),
      cwd: process.cwd(),
      env: sanitizedProcessEnv({
        [OPENCODE_PROCESS_ROLE]: "broker",
        [OPENCODE_RUN_ID]: ensureRunID(),
      }),
      stderr: "inherit",
      stdout: "pipe",
      stdin: "pipe",
    })
    const pending = new Map<string, Pending>()
    let capabilities: SandboxBackendStatus[] | undefined
    let ready = false
    let waiters: Array<(value: SandboxBackendStatus[]) => void> = []
    const fail = (error: Error) => {
      for (const item of pending.values()) item.reject(error)
      pending.clear()
      for (const item of waiters) item([])
      waiters = []
    }
    const parser = createFrameParser((frame) => {
      if (frame.type === "broker.hello") {
        ready = frame.protocol_version === SANDBOX_PROTOCOL_VERSION
        return
      }
      if (frame.type === "broker.capabilities") {
        capabilities = frame.backends
        const current = waiters
        waiters = []
        for (const item of current) item(frame.backends)
        return
      }
      if (frame.type === "exec.exit") {
        const item = pending.get(frame.result.request_id)
        if (!item) return
        pending.delete(frame.result.request_id)
        item.resolve(frame.result)
        return
      }
      if (!("request_id" in frame)) return
      const item = pending.get(frame.request_id)
      if (!item) return
      if (frame.type === "exec.stdout") {
        item.onStdout(frame.chunk)
        return
      }
      if (frame.type === "exec.stderr") {
        item.onStderr(frame.chunk)
        return
      }
      if (frame.type === "exec.error") {
        pending.delete(frame.request_id)
        item.reject(new Error(frame.error))
      }
    }, fail)
    ;(async () => {
      try {
        const reader = proc.stdout.getReader()
        while (true) {
          const next = await reader.read()
          if (next.done) break
          if (next.value) parser(next.value)
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })()

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        try {
          for (const requestID of pending.keys()) {
            try {
              proc.stdin.write(
                encodeFrame({
                  type: "exec.abort",
                  protocol_version: SANDBOX_PROTOCOL_VERSION,
                  request_id: requestID,
                }),
              )
            } catch {}
          }
        } catch {}
        try {
          proc.stdin.end()
        } catch {}
        proc.kill()
      }),
    )

    const send = (frame: Parameters<typeof encodeFrame>[0]) => {
      try {
        proc.stdin.write(encodeFrame(frame))
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }

    const capabilitiesEffect = Effect.promise(
      () =>
        new Promise<SandboxBackendStatus[]>((resolve, reject) => {
          if (!ready && proc.killed) {
            reject(new Error("Sandbox broker failed to start"))
            return
          }
          if (capabilities) {
            resolve(capabilities)
            return
          }
          waiters.push(resolve)
        }),
    )

    const exec: Interface["exec"] = Effect.fn("SandboxBroker.exec")(function* (input) {
      const result = yield* Effect.promise(
        () =>
          new Promise<SandboxExecResult>((resolve, reject) => {
            const requestID = input.request.request_id
            const abort = () => {
              try {
                send({
                  type: "exec.abort",
                  protocol_version: SANDBOX_PROTOCOL_VERSION,
                  request_id: requestID,
                })
              } catch {}
            }
            const cleanup = () => {
              input.abort?.removeEventListener("abort", abort)
              pending.delete(requestID)
            }
            pending.set(requestID, {
              onStdout: input.onStdout,
              onStderr: input.onStderr,
              resolve: (value) => {
                cleanup()
                resolve(value)
              },
              reject: (error) => {
                cleanup()
                reject(error)
              },
            })
            if (input.abort?.aborted) {
              abort()
              cleanup()
              reject(new Error("Command aborted before start"))
              return
            }
            input.abort?.addEventListener("abort", abort, { once: true })
            send({
              type: "exec.start",
              protocol_version: SANDBOX_PROTOCOL_VERSION,
              request: input.request,
            })
          }),
      )
      return result
    })

    return Service.of({
      capabilities: () => capabilitiesEffect,
      exec,
    })
  }),
)

export const defaultLayer = layer
export const SandboxBroker = {
  Service,
  layer,
  defaultLayer,
}
