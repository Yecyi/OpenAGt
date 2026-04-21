/**
 * Shell Execution Module
 *
 * Extracted from session/prompt.ts
 * Handles shell command execution with platform-specific shell invocation
 */

import { Effect, Stream, Context, Exit, Cause } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { Plugin } from "@/plugin"
import { InstanceState } from "@/effect"
import { Session } from "@/session"
import { Agent } from "@/agent/agent"
import { MessageV2 } from "@/session/message-v2"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { SessionRevert } from "@/session/revert"
import { Shell } from "@/shell/shell"
import { Log } from "@/util"
import { ulid } from "ulid"
import path from "path"
import * as SessionModule from "@/session/session"

const log = Log.create({ service: "shell-execution" })

/**
 * Input for shell execution
 */
export interface ShellInput {
  sessionID: SessionID
  command: string
  messageID?: MessageID
  agent?: string
  model?: any
}

/**
 * Shell execution result
 */
export interface ShellResult {
  info: MessageV2.Assistant
  parts: MessageV2.Part[]
}

/**
 * Shell invocation configuration for different shells
 */
export interface ShellInvocation {
  shell: string
  args: string[]
  options?: {
    cwd?: string
    env?: Record<string, string>
    stdin?: "ignore" | "pipe"
  }
}

/**
 * Get shell invocation configuration for the current platform
 */
export function getShellInvocation(command: string, cwd: string): ShellInvocation {
  const sh = Shell.preferred()
  const shellName = (
    process.platform === "win32" ? path.win32.basename(sh, ".exe") : path.basename(sh)
  ).toLowerCase()

  const invocations: Record<string, { args: string[] }> = {
    nu: { args: ["-c", command] },
    fish: { args: ["-c", command] },
    zsh: {
      args: [
        "-l",
        "-c",
        `
          __oc_cwd=$PWD
          [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
          [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
          cd "$__oc_cwd"
          eval ${JSON.stringify(command)}
        `,
      ],
    },
    bash: {
      args: [
        "-l",
        "-c",
        `
          __oc_cwd=$PWD
          shopt -s expand_aliases
          [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
          cd "$__oc_cwd"
          eval ${JSON.stringify(command)}
        `,
      ],
    },
    cmd: { args: ["/c", command] },
    powershell: { args: ["-NoProfile", "-Command", command] },
    pwsh: { args: ["-NoProfile", "-Command", command] },
    "": { args: ["-c", command] },
  }

  const args = (invocations[shellName] ?? invocations[""]).args
  return { shell: sh, args, options: { cwd } }
}
