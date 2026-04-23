import path from "path"
import { Global } from "@/global"
import { Flag } from "@/flag/flag"
import { spawn } from "child_process"
import type {
  SandboxBackendName,
  SandboxBackendStatus,
  SandboxExecRequest,
  SandboxExecResult,
  SandboxPolicySummary,
} from "./types"

export type SandboxBackendHandle = {
  kill: () => void
}

export type SandboxBackendRunInput = {
  request: SandboxExecRequest
  onStdout: (chunk: string) => void
  onStderr: (chunk: string) => void
  onExit: (result: SandboxExecResult) => void
  onError: (error: string, backend: SandboxBackendName) => void
}

export type SandboxBackend = {
  readonly status: SandboxBackendStatus
  readonly run: (input: SandboxBackendRunInput) => SandboxBackendHandle
}

function summary(request: SandboxExecRequest, reportOnly: boolean): SandboxPolicySummary {
  return {
    enforcement: request.enforcement,
    backendPreference: request.backend_preference,
    filesystemPolicy: request.filesystem_policy,
    networkPolicy: request.network_policy,
    allowedPaths: request.allowed_paths,
    writablePaths: request.writable_paths,
    reportOnly,
  }
}

function helperStatus(name: SandboxBackendName, helper: string | undefined, available: boolean, reason?: string) {
  return {
    name,
    available,
    ...(helper ? { helper } : {}),
    ...(reason ? { reason } : {}),
  } satisfies SandboxBackendStatus
}

function unavailable(name: SandboxBackendName, reason: string) {
  return {
    status: helperStatus(name, undefined, false, reason),
    run(input) {
      queueMicrotask(() => input.onError(reason, name))
      return { kill() {} }
    },
  } satisfies SandboxBackend
}

function shellArgs(request: SandboxExecRequest) {
  if (process.platform === "win32") {
    if (request.shell_family === "powershell") {
      return [request.shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", request.command]] as const
    }
    return [request.shell, ["/d", "/s", "/c", request.command]] as const
  }
  return ["/bin/sh", ["-c", request.command]] as const
}

async function killProcessTree(pid: number | undefined, exited?: () => boolean) {
  if (!pid || exited?.()) return
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("exit", () => resolve())
      killer.once("error", () => resolve())
    })
    return
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
  }
}

function processBackend(): SandboxBackend {
  return {
    status: helperStatus("process", process.execPath, true),
    run(input) {
      const [cmd, args] = shellArgs(input.request)
      let finished = false
      let terminationReason: SandboxExecResult["termination_reason"] = "exit"
      const exit = (result: SandboxExecResult) => {
        if (finished) return
        finished = true
        input.onExit(result)
      }
      const fail = (message: string) => {
        if (finished) return
        finished = true
        input.onError(message, "process")
      }
      const child = Bun.spawn({
        cmd: args.length ? [cmd, ...args] : [input.request.shell, "-lc", input.request.command],
        cwd: input.request.cwd,
        env: input.request.env,
        stderr: "pipe",
        stdout: "pipe",
        stdin: "ignore",
      })
      const timer = setTimeout(() => {
        terminationReason = "timeout"
        void killProcessTree(child.pid, () => child.exitCode !== null)
      }, input.request.timeout_ms)
      const pipe = async (stream: ReadableStream<Uint8Array> | null, onChunk: (text: string) => void) => {
        if (!stream) return
        const reader = stream.getReader()
        while (true) {
          const next = await reader.read().catch(() => ({ done: true, value: undefined }))
          if (next.done || !next.value) break
          onChunk(new TextDecoder().decode(next.value))
        }
      }
      const stdout = pipe(child.stdout, input.onStdout)
      const stderr = pipe(child.stderr, input.onStderr)
      child.exited
        .then(async (exitCode) => {
          clearTimeout(timer)
          await Promise.race([
            Promise.allSettled([stdout, stderr]),
            new Promise((resolve) => setTimeout(resolve, 100)),
          ])
          exit({
            request_id: input.request.request_id,
            exit_code: terminationReason === "exit" ? exitCode : null,
            termination_reason: terminationReason,
            backend_used: "process",
            stdout_tail: "",
            stderr_tail: "",
            policy_summary: summary(input.request, true),
          })
        })
        .catch((error) => {
          clearTimeout(timer)
          fail(error instanceof Error ? error.message : String(error))
        })
      return {
        kill() {
          clearTimeout(timer)
          terminationReason = "abort"
          void killProcessTree(child.pid, () => child.exitCode !== null)
        },
      }
    },
  }
}

export function detectBackends() {
  const seatbeltHelper = Flag.OPENCODE_SANDBOX_SEATBELT_HELPER
  const windowsHelper = Flag.OPENCODE_SANDBOX_WINDOWS_HELPER
  const landlockHelper = Flag.OPENCODE_SANDBOX_LANDLOCK_HELPER
  return [
    processBackend(),
    process.platform === "darwin" && seatbeltHelper
      ? unavailable("seatbelt", `Seatbelt helper not implemented yet: ${seatbeltHelper}`)
      : unavailable("seatbelt", "Seatbelt helper unavailable"),
    process.platform === "win32" && windowsHelper
      ? unavailable("windows_native", `Windows helper not implemented yet: ${windowsHelper}`)
      : unavailable("windows_native", "Windows native helper unavailable"),
    process.platform === "linux" && landlockHelper
      ? unavailable("landlock", `Landlock helper not implemented yet: ${landlockHelper}`)
      : unavailable("landlock", "Landlock helper unavailable"),
  ] satisfies SandboxBackend[]
}

export function brokerLogFile() {
  return path.join(Global.Path.log, "sandbox-broker.log")
}
