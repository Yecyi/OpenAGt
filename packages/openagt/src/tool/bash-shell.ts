// Selects the shell used by BashTool and exposes shell-family constants.
// It does not parse commands, ask permissions, or execute shell processes.
import { Flag } from "@/flag/flag"
import { Shell } from "@/shell/shell"

export const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

const POWERSHELL_NAMES = new Set(["powershell", "pwsh"])

const POWERSHELL_TOKENS = [
  "$env:",
  "${env:",
  "$pshome",
  "$pwd",
  "write-host",
  "write-output",
  "get-content",
  "set-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "set-location",
  "push-location",
  "pop-location",
  "if ($?",
]

export function isPowerShellName(name: string): boolean {
  return POWERSHELL_NAMES.has(name)
}

export function chooseShell(command: string): string {
  const acceptable = Shell.acceptable()
  if (process.platform !== "win32") return acceptable
  const text = command.trim().toLowerCase()
  const hasPowerShellSyntax =
    POWERSHELL_TOKENS.some((item) => text.includes(item)) || /(^|[\s;(])&\s+["'a-z_$({]/i.test(text)
  if (hasPowerShellSyntax) {
    const preferred = Shell.preferred()
    const name = Shell.name(preferred)
    if (isPowerShellName(name)) return preferred
    const pwsh = Bun.which("pwsh")
    if (pwsh) return pwsh
    const powershell = Bun.which("powershell")
    if (powershell) return powershell
  }
  return acceptable
}
