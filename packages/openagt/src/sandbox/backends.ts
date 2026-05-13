import path from "path"
import { Global } from "@/global"
import { Flag } from "@/flag/flag"
import { spawn } from "child_process"
import { probeWindowsHelper, resolveWindowsHelperPath } from "./windows-helper"
import type {
  SandboxBackendName,
  SandboxBackendStatus,
  SandboxExecRequest,
  SandboxExecResult,
  SandboxPolicyAdvisory,
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

// `enforced=false` for the process backend: it has no OS-level isolation
// (no chroot/seccomp/namespaces/Landlock). The fields above describe what the
// caller *requested*, not what was applied.
function advisory(request: SandboxExecRequest, reportOnly: boolean): SandboxPolicyAdvisory {
  return {
    enforcement: request.enforcement,
    backendPreference: request.backend_preference,
    filesystemPolicy: request.filesystem_policy,
    networkPolicy: request.network_policy,
    allowedPaths: request.allowed_paths,
    writablePaths: request.writable_paths,
    reportOnly,
    enforced: false,
    filesystemEnforced: false,
    networkEnforced: false,
  }
}

function helperStatus(
  name: SandboxBackendName,
  helper: string | undefined,
  available: boolean,
  reason?: string,
  extra?: Partial<SandboxBackendStatus>,
) {
  return {
    name,
    available,
    ...(helper ? { helper } : {}),
    ...(reason ? { reason } : {}),
    ...extra,
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

export function autoBackendName(platform = process.platform): SandboxBackendName {
  if (platform === "darwin") return "seatbelt"
  if (platform === "win32") return "windows_native"
  if (platform === "linux") return "landlock"
  return "process"
}

export function powershellEncodedCommand(command: string) {
  return Buffer.from(command, "utf16le").toString("base64")
}

function shellArgs(request: SandboxExecRequest) {
  if (process.platform === "win32") {
    if (request.shell_family === "powershell") {
      return [
        request.shell,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", powershellEncodedCommand(request.command)],
      ] as const
    }
    if (request.shell_family === "posix") {
      return [request.shell, ["-c", request.command]] as const
    }
    return [request.shell, ["/d", "/s", "/c", request.command]] as const
  }
  return ["/bin/sh", ["-c", request.command]] as const
}

async function killProcessTree(pid: number | undefined, exited?: () => boolean, graceMs = 2000) {
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
  const signal = (value: NodeJS.Signals) => {
    try {
      process.kill(-pid, value)
      return
    } catch {
      try {
        process.kill(pid, value)
      } catch {}
    }
  }
  signal("SIGTERM")
  setTimeout(() => {
    if (!exited?.()) signal("SIGKILL")
  }, graceMs)
}

function processBackend(): SandboxBackend {
  return {
    status: helperStatus("process", process.execPath, true, "Process-level enforcement only; not an OS-native sandbox"),
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
        detached: process.platform !== "win32",
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
            new Promise((resolve) => setTimeout(resolve, 1000)),
          ])
          exit({
            request_id: input.request.request_id,
            exit_code: terminationReason === "exit" ? exitCode : null,
            termination_reason: terminationReason,
            backend_used: "process",
            stdout_tail: "",
            stderr_tail: "",
            policy_advisory: advisory(input.request, true),
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

function windowsNativeBackend(status: SandboxBackendStatus): SandboxBackend {
  return {
    status,
    run(input) {
      if (!status.helper) {
        queueMicrotask(() => input.onError("Windows native helper path is missing", "windows_native"))
        return { kill() {} }
      }
      let finished = false
      const child = Bun.spawn({
        cmd: [status.helper, "exec"],
        cwd: input.request.cwd,
        env: {
          ...input.request.env,
          ...(status.acl_apply_mode ? { OPENAGT_SANDBOX_WINDOWS_APPLY_ACL: status.acl_apply_mode } : {}),
        },
        stderr: "pipe",
        stdout: "pipe",
        stdin: "pipe",
      })
      child.stdin.write(JSON.stringify(input.request))
      child.stdin.end()
      const finishError = (message: string) => {
        if (finished) return
        finished = true
        input.onError(message, "windows_native")
      }
      const timer = setTimeout(() => {
        void killProcessTree(child.pid, () => child.exitCode !== null)
      }, input.request.timeout_ms + 1_000)
      child.exited
        .then(async (exitCode) => {
          clearTimeout(timer)
          const [stdout, stderr] = await Promise.all([
            new Response(child.stdout).text().catch(() => ""),
            new Response(child.stderr).text().catch(() => ""),
          ])
          if (exitCode !== 0) {
            finishError(stderr.trim() || `Windows native helper failed with ${exitCode}`)
            return
          }
          try {
            const result = JSON.parse(stdout) as SandboxExecResult
            if (result.stdout_tail) input.onStdout(result.stdout_tail)
            if (result.stderr_tail) input.onStderr(result.stderr_tail)
            if (finished) return
            finished = true
            input.onExit(result)
          } catch (error) {
            finishError(
              `Windows native helper returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        })
        .catch((error) => {
          clearTimeout(timer)
          finishError(error instanceof Error ? error.message : String(error))
        })
      return {
        kill() {
          clearTimeout(timer)
          void killProcessTree(child.pid, () => child.exitCode !== null)
        },
      }
    },
  }
}

export function detectBackends() {
  const seatbeltHelper = Flag.OPENCODE_SANDBOX_SEATBELT_HELPER
  const windowsHelper = Flag.OPENAGT_SANDBOX_WINDOWS_HELPER
  const landlockHelper = Flag.OPENCODE_SANDBOX_LANDLOCK_HELPER
  const resolvedWindowsHelper = resolveWindowsHelperPath({ override: windowsHelper })
  const windowsNativeStatus =
    process.platform === "win32" && resolvedWindowsHelper.path
      ? probeWindowsHelper(resolvedWindowsHelper.path)
      : undefined
  const windowsNative = windowsNativeStatus?.available
    ? windowsNativeBackend(windowsNativeStatus)
    : windowsNativeStatus
      ? {
          ...unavailable("windows_native", windowsNativeStatus.reason ?? "Windows native helper unavailable"),
          status: windowsNativeStatus,
        }
      : unavailable("windows_native", resolvedWindowsHelper.reason ?? "Windows native helper unavailable")
  return [
    processBackend(),
    process.platform === "darwin" && seatbeltHelper
      ? unavailable("seatbelt", `Seatbelt helper not implemented yet: ${seatbeltHelper}`)
      : unavailable("seatbelt", "Seatbelt helper unavailable"),
    windowsNative,
    process.platform === "linux" && landlockHelper
      ? unavailable("landlock", `Landlock helper not implemented yet: ${landlockHelper}`)
      : unavailable("landlock", "Landlock helper unavailable"),
  ] satisfies SandboxBackend[]
}

export function brokerLogFile() {
  return path.join(Global.Path.log, "sandbox-broker.log")
}
