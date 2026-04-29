// Builds process sandbox command lines and resource-limit env overlays.
// It does not spawn processes, collect output, or mutate sandbox stats.
import { Shell } from "@/shell/shell"
import type { ProcessSandboxOptions } from "./process-sandbox"

const DEFAULT_CMD = "C:\\WINDOWS\\system32\\cmd.exe"
const DEFAULT_POWERSHELL = "powershell.exe"

export function sandboxShellKind(shell?: string): "cmd" | "powershell" | "posix" {
  if (process.platform !== "win32") return "posix"
  const name = shell ? Shell.name(shell) : "cmd"
  if (name === "powershell" || name === "pwsh") return "powershell"
  if (Shell.posix(shell || "")) return "posix"
  return "cmd"
}

export function buildSandboxArgs(command: string, shell?: string): [string, string[]] {
  if (process.platform === "win32") {
    if (sandboxShellKind(shell) === "powershell") {
      return [shell || DEFAULT_POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]]
    }
    if (sandboxShellKind(shell) === "posix") {
      return [shell || "/bin/sh", [Shell.login(shell || "") ? "-lc" : "-c", command]]
    }
    return [shell || DEFAULT_CMD, ["/d", "/s", "/c", command]]
  }
  return [shell || "/bin/sh", ["-c", command]]
}

export function applySandboxResourceLimits(options: ProcessSandboxOptions): Record<string, string> {
  const env: Record<string, string> = {}
  const existingNodeOptions = options.env?.NODE_OPTIONS?.trim()
  const limits = options.limits
  const nodeOptions = [existingNodeOptions].filter(Boolean)

  if (limits?.maxMemory) {
    nodeOptions.push(`--max-old-space-size=${Math.max(1, Math.floor(limits.maxMemory / 1024 / 1024))}`)
  }

  if (limits?.maxStack) {
    nodeOptions.push(`--stack-size=${Math.max(1, Math.floor(limits.maxStack / 1024))}`)
  }

  if (nodeOptions.length > 0) {
    env.NODE_OPTIONS = nodeOptions.join(" ")
  }

  return env
}
