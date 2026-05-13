// Shell-family detection for dangerous command scanning.
// This file maps shell executable names to detector families; it does not inspect command text.

import { Shell } from "@/shell/shell"
import type { ShellFamily } from "./danger-detector-contracts"

export function detectShellFamily(shell?: string): ShellFamily {
  if (!shell) return "unknown"
  const name = Shell.name(shell)
    .replace(/\.exe$/i, "")
    .toLowerCase()
  if (name === "powershell" || name === "pwsh") return "powershell"
  if (name === "cmd") return "cmd"
  if (["bash", "zsh", "fish", "sh", "dash", "ksh", "ash"].includes(name)) return "posix"
  return "unknown"
}
