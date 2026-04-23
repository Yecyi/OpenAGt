import z from "zod"
import os from "os"
import * as Tool from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language, type Node } from "web-tree-sitter"

import { AppFileSystem } from "@openagt/shared/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag"
import { Shell } from "@/shell/shell"
import { ShellRunner } from "@/shell/runner"
import { SandboxBroker } from "@/sandbox/broker"
import { SandboxPolicy } from "@/sandbox/policy"
import type { ResolvedPolicy } from "@/sandbox/policy"

import { BashArity } from "@/permission/arity"
import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

import {
  classifyApprovalKind,
  formatShellSafety,
  isPrivilegeEscalationCommand,
  ShellSecurity,
} from "../security/shell-security"
import type { ShellDecision, ShellFinding, ShellRiskLevel, ShellSafety } from "../security/shell-security"
import { ExecPolicy } from "@/security/exec-policy"
import type { ExecPolicyDecision } from "@/security/exec-policy"
import type {
  SandboxBackendName,
  SandboxBackendStatus,
  SandboxBackendPreference,
  SandboxEnforcement,
  SandboxFilesystemPolicy,
  SandboxNetworkPolicy,
} from "@/sandbox/types"

type BashMetadata = {
  output: string
  exit: number | null
  description: string
  truncated: boolean
  findings: ShellFinding[]
  riskLevel: ShellRiskLevel
  decision: ShellDecision
  reviewApiVersion: 1
  reviewMode: "disabled"
  reviewStatus: "not_requested"
  policyDecision?: ExecPolicyDecision
  policyReason?: string
  matchedRules?: string[]
  shell_safety?: ShellSafety
  safetySummary?: string
  safetyDetails?: string[]
  outputPath?: string
  backendPreference?: SandboxBackendPreference
  enforcement?: SandboxEnforcement
  filesystemPolicy?: SandboxFilesystemPolicy
  networkPolicy?: SandboxNetworkPolicy
  allowedPaths?: string[]
  writablePaths?: string[]
  backendUsed?: string
  terminationReason?: string
}

const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
const PS = new Set(["powershell", "pwsh"])
const CWD = new Set(["cd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])
const PS_TOKENS = [
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

const Parameters = z.object({
  command: z.string().describe("The command to execute"),
  timeout: z.number().describe("Optional timeout in milliseconds").optional(),
  workdir: z
    .string()
    .describe(
      `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    )
    .optional(),
  description: z
    .string()
    .describe(
      "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
    ),
})

type Part = {
  type: string
  text: string
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

function parts(node: Node) {
  const out: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean) {
  if (!ps) {
    return list
      .slice(1)
      .filter((item) => !item.text.startsWith("-") && !(list[0]?.text === "chmod" && item.text.startsWith("+")))
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function chooseShell(command: string) {
  const acceptable = Shell.acceptable()
  if (process.platform !== "win32") return acceptable
  const text = command.trim().toLowerCase()
  const hasPowerShellSyntax =
    PS_TOKENS.some((item) => text.includes(item)) || /(^|[\s;(])&\s+["'a-z_$({]/i.test(text)
  if (hasPowerShellSyntax) {
    const preferred = Shell.preferred()
    const name = Shell.name(preferred)
    if (PS.has(name)) return preferred
    const pwsh = Bun.which("pwsh")
    if (pwsh) return pwsh
    const powershell = Bun.which("powershell")
    if (powershell) return powershell
  }
  return acceptable
}

const parse = Effect.fn("BashTool.parse")(function* (command: string, ps: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree.rootNode
})

const ask = Effect.fn("BashTool.ask")(function* (
  ctx: Tool.Context,
  scan: Scan,
  metadata: Record<string, unknown>,
) {
  if (scan.dirs.size > 0) {
    const globs = Array.from(scan.dirs).map((dir) => {
      if (process.platform === "win32") return AppFileSystem.normalizePathPattern(path.join(dir, "*"))
      return path.join(dir, "*")
    })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {},
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: "bash",
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata,
  })
})

const askShellExecute = Effect.fn(
  "BashTool.askShellExecute",
)(function* (
  ctx: Tool.Context,
  input: {
    patterns: string[]
    metadata: Record<string, unknown>
  },
) {
  yield* ctx.ask({
    permission: "shell_execute",
    patterns: input.patterns,
    always: [],
    metadata: input.metadata,
  })
})

const askShellNetwork = Effect.fn(
  "BashTool.askShellNetwork",
)(function* (
  ctx: Tool.Context,
  input: {
    patterns: string[]
    metadata: Record<string, unknown>
  },
) {
  yield* ctx.ask({
    permission: "shell_network",
    patterns: input.patterns,
    always: [],
    metadata: input.metadata,
  })
})

const DECISION_ORDER: Record<ExecPolicyDecision, number> = {
  allow: 0,
  confirm: 1,
  block: 2,
}

function stricterDecision(left: ExecPolicyDecision, right: ExecPolicyDecision): ExecPolicyDecision {
  return DECISION_ORDER[left] >= DECISION_ORDER[right] ? left : right
}

function preferredBackendName(preference: SandboxBackendPreference): SandboxBackendName | undefined {
  if (preference !== "auto") return preference
  if (process.platform === "darwin") return "seatbelt"
  if (process.platform === "win32") return "windows_native"
  return "landlock"
}

function preferredBackendStatus(
  preference: SandboxBackendPreference,
  capabilities: SandboxBackendStatus[],
) {
  const name = preferredBackendName(preference)
  if (!name) return
  return capabilities.find((item) => item.name === name)
}

function backendAvailability(
  preference: SandboxBackendPreference,
  capabilities: SandboxBackendStatus[],
) {
  const backend = preferredBackendStatus(preference, capabilities)
  if (!backend) return preference === "auto" ? "auto:unknown" : `${preference}:unknown`
  if (backend.available) return `${backend.name}:available`
  return `${backend.name}:unavailable${backend.reason ? ` (${backend.reason})` : ""}`
}

function sandboxEscalationReason(input: {
  decision: ShellDecision
  matchedRules: string[]
  privilegeEscalation: boolean
  needsNetworkPermission: boolean
  policy: Pick<ResolvedPolicy, "sandbox" | "backend_preference">
  capabilities: SandboxBackendStatus[]
}) {
  if (input.decision === "block") return
  if (input.matchedRules.length > 0) return
  if (input.privilegeEscalation) return
  if (input.needsNetworkPermission) return
  if (!input.policy.sandbox.enabled) {
    return "Sandbox is disabled; confirmation required before running without isolation."
  }
  if (input.policy.sandbox.report_only) {
    return "Sandbox enforcement is in report-only mode; confirmation required before running without enforcement."
  }
  const backend = preferredBackendStatus(input.policy.backend_preference, input.capabilities)
  if (!backend?.available && input.policy.backend_preference !== "auto" && input.policy.sandbox.failure_policy !== "closed") {
    return `Sandbox backend ${backend?.name ?? input.policy.backend_preference} is unavailable; confirmation required before downgrade.`
  }
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const psPath = resolveWasm(psWasm)
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define(
  "bash",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const fs = yield* AppFileSystem.Service
    const plugin = yield* Plugin.Service
    const shellSecurity = yield* ShellSecurity.Service
    const execPolicy = yield* ExecPolicy.Service
    const sandboxBroker = yield* SandboxBroker.Service
    const shellRunner = yield* ShellRunner.Service
    const sandboxPolicy = yield* SandboxPolicy.Service

    const cygpath = Effect.fn("BashTool.cygpath")(function* (shell: string, text: string) {
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text], {
            cwd: Instance.directory,
            extendEnv: true,
            stdin: "ignore",
            stderr: "ignore",
          }),
        )
        .pipe(Effect.scoped)
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!handle) return
      const output = yield* Stream.decodeText(handle.stdout).pipe(
        Stream.runCollect,
        Effect.map((chunk) => [...chunk].join("")),
        Effect.catch(() => Effect.succeed("")),
      )
      const file = output.split(/\r?\n/)[0]?.trim()
      if (!file) return
      return AppFileSystem.normalizePath(file)
    })

    const resolvePath = Effect.fn("BashTool.resolvePath")(function* (text: string, root: string, shell: string) {
      if (process.platform === "win32") {
        if (Shell.posix(shell) && text.startsWith("/")) {
          const file = yield* cygpath(shell, text)
          if (file) return file
          if (text === "/tmp" || text.startsWith("/tmp/")) {
            const suffix = text.slice("/tmp".length).replaceAll("/", path.sep)
            return AppFileSystem.normalizePath(path.join(os.tmpdir(), suffix))
          }
        }
        return AppFileSystem.normalizePath(path.resolve(root, AppFileSystem.windowsPath(text)))
      }
      return path.resolve(root, text)
    })

    const argPath = Effect.fn("BashTool.argPath")(function* (arg: string, cwd: string, ps: boolean, shell: string) {
      const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
      const file = text && prefix(text)
      if (!file || dynamic(file, ps)) return
      const next = ps ? provider(file) : file
      if (!next) return
      return yield* resolvePath(next, cwd, shell)
    })

    const collect = Effect.fn("BashTool.collect")(function* (root: Node, cwd: string, ps: boolean, shell: string) {
      const scan: Scan = {
        dirs: new Set<string>(),
        patterns: new Set<string>(),
        always: new Set<string>(),
      }

      const allCommands = commands(root)
      const MAX_SUBCOMMANDS = 32

      if (allCommands.length > MAX_SUBCOMMANDS) {
        log.warn("command chain exceeds max subcommands", { count: allCommands.length, max: MAX_SUBCOMMANDS })
      }

      let maxRisk: "safe" | "low" | "medium" | "high" = "safe"
      const allFindings: Array<{ severity: string; evidence: string }> = []
      const riskDistribution: Record<string, number> = { safe: 0, low: 0, medium: 0, high: 0 }

      for (let i = 0; i < Math.min(allCommands.length, MAX_SUBCOMMANDS); i++) {
        const node = allCommands[i]
        const command = parts(node)
        const tokens = command.map((item) => item.text)
        const cmd = ps ? tokens[0]?.toLowerCase() : tokens[0]
        const subCmd = source(node)

        // Analyze each subcommand for risk
        const subSecurity = yield* shellSecurity.analyze({
          command: subCmd,
          shell,
          cwd,
        })

        // Track max risk across all subcommands
        const riskLevels: Record<string, number> = { safe: 0, low: 1, medium: 2, high: 3 }
        const subRisk = riskLevels[subSecurity.risk_level] ?? 0
        const maxRiskNum = riskLevels[maxRisk] ?? 0
        if (subRisk > maxRiskNum) {
          maxRisk = subSecurity.risk_level
        }
        // C-1: Track risk level distribution
        riskDistribution[subSecurity.risk_level] = (riskDistribution[subSecurity.risk_level] || 0) + 1
        allFindings.push(...subSecurity.findings.map((f) => ({ severity: f.severity, evidence: f.evidence })))

        if (cmd && FILES.has(cmd)) {
          for (const arg of pathArgs(command, ps)) {
            const resolved = yield* argPath(arg, cwd, ps, shell)
            log.info("resolved path", { arg, resolved })
            if (!resolved || Instance.containsPath(resolved)) continue
            const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
            scan.dirs.add(dir)
          }
        }

        if (tokens.length && (!cmd || !CWD.has(cmd))) {
          scan.patterns.add(subCmd)
          scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
        }
      }

      // Log compound classification
      if (allCommands.length > 1) {
        log.info("compound command classified", {
          subcommands: allCommands.length,
          maxRisk,
          findingsCount: allFindings.length,
        })
      }

      // C-1: Emit shell.risk_level_distribution metric
      log.info("shell.risk_level_distribution", riskDistribution)

      return scan
    })

    const shellEnv = Effect.fn("BashTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      return {
        ...process.env,
        ...extra.env,
      }
    })

    return {
      description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
        .replaceAll("${os}", process.platform)
        .replaceAll("${shell}", Shell.name(Shell.acceptable()))
        .replaceAll(
          "${chaining}",
          Shell.name(Shell.acceptable()) === "powershell"
            ? "If the commands depend on each other and must run sequentially, avoid '&&' in this shell because Windows PowerShell 5.1 does not support it. Use PowerShell conditionals such as `cmd1; if ($?) { cmd2 }` when later commands must depend on earlier success."
            : "If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.",
        )
        .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
        .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context<BashMetadata>): Effect.Effect<Tool.ExecuteResult<BashMetadata>, never, never> =>
        Effect.gen(function* () {
          const shell = chooseShell(params.command)
          const name = Shell.name(shell)
          log.info("bash tool using shell", { shell })
          const cwd = params.workdir ? yield* resolvePath(params.workdir, Instance.directory, shell) : Instance.directory
          if (params.timeout !== undefined && params.timeout < 0) {
            throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
          }

          const timeout = params.timeout ?? DEFAULT_TIMEOUT
          const ps = PS.has(name)
          const root = yield* parse(params.command, ps)
          const scan = yield* collect(root, cwd, ps, shell)
          if (!Instance.containsPath(cwd)) scan.dirs.add(cwd)

          const security = yield* shellSecurity.analyze({
            command: params.command,
            shell,
            cwd,
          })
          const policyDecision = yield* execPolicy.evaluate({
            command: security.normalized_command || params.command,
            shellFamily: security.shell_family,
          })
          const preliminaryDecision = stricterDecision(security.decision, policyDecision.decision)
          const preliminaryReason =
            preliminaryDecision === policyDecision.decision && policyDecision.matchedRules.length > 0
              ? policyDecision.reason
              : security.explanation
          const matchedRules = policyDecision.matchedRules.map((item) => item.pattern.join(" "))
          const externalPaths = Array.from(scan.dirs)
          const permissionMetadata = shellSecurity.createPermissionMetadata({
            result: security,
            description: params.description ?? "Shell command",
            workdir: cwd,
            externalPaths,
          })
          const preliminaryPolicy = yield* sandboxPolicy.resolve({
            result: security,
            decision: preliminaryDecision,
            cwd,
            externalPaths,
          })
          const capabilities = yield* sandboxBroker.capabilities()
          const privilegeEscalation = isPrivilegeEscalationCommand(security.normalized_command || params.command)
          const escalationReason = sandboxEscalationReason({
            decision: preliminaryDecision,
            matchedRules,
            privilegeEscalation,
            needsNetworkPermission: preliminaryPolicy.needs_network_permission,
            policy: preliminaryPolicy,
            capabilities,
          })
          const finalDecision = escalationReason ? stricterDecision(preliminaryDecision, "confirm") : preliminaryDecision
          const finalReason = escalationReason && preliminaryDecision === "allow" ? escalationReason : preliminaryReason
          const policy = finalDecision === preliminaryDecision
            ? preliminaryPolicy
            : yield* sandboxPolicy.resolve({
                result: security,
                decision: finalDecision,
                cwd,
                externalPaths,
              })
          const backendAvailabilitySummary = backendAvailability(policy.backend_preference, capabilities)
          const approvalKind = classifyApprovalKind({
            decision: finalDecision,
            reason: finalReason,
            matchedRules,
            needsNetworkPermission: policy.needs_network_permission,
            privilegeEscalation,
            sandboxEscalation: Boolean(escalationReason),
          })
          const shellSafety = formatShellSafety({
            decision: finalDecision,
            riskLevel: security.risk_level,
            reason: finalReason,
            approvalKind,
            approvalRequired: finalDecision !== "allow" || policy.needs_network_permission,
            policySource: policyDecision.matchedRules.length > 0
              ? "exec_policy"
              : escalationReason
                ? "sandbox_policy"
              : policy.needs_network_permission
                ? "sandbox_policy"
                : "shell_security",
            backendPreference: policy.backend_preference,
            enforcement: policy.enforcement,
            filesystemPolicy: policy.filesystem_policy,
            networkPolicy: policy.network_policy,
            backendAvailability: backendAvailabilitySummary,
            policyReason: finalReason,
            matchedRules,
          })
          const networkReason = "Command requires network access."
          const networkShellSafety = policy.needs_network_permission
            ? formatShellSafety({
                decision: "confirm",
                riskLevel: security.risk_level,
                reason: networkReason,
                approvalKind: "network_access",
                approvalRequired: true,
                policySource: "sandbox_policy",
                backendPreference: policy.backend_preference,
                enforcement: policy.enforcement,
                filesystemPolicy: policy.filesystem_policy,
                networkPolicy: policy.network_policy,
                backendAvailability: backendAvailabilitySummary,
                policyReason: finalReason,
                matchedRules,
              })
            : undefined
          const metadata = {
            ...permissionMetadata,
            decision: finalDecision,
            reason: finalReason,
            backendPreference: policy.backend_preference,
            enforcement: policy.enforcement,
            filesystemPolicy: policy.filesystem_policy,
            networkPolicy: policy.network_policy,
            allowedPathsSummary: policy.allowed_paths,
            backendAvailability: backendAvailabilitySummary,
            ...(policyDecision.matchedRules.length > 0 ? { policyDecision: policyDecision.decision } : {}),
            ...(policyDecision.matchedRules.length > 0 ? { policyReason: policyDecision.reason } : {}),
            ...(matchedRules.length > 0 ? { matchedRules } : {}),
            shell_safety: shellSafety,
            safetySummary: shellSafety.summary,
            safetyDetails: shellSafety.details,
          }
          const networkMetadata = networkShellSafety
            ? {
                ...metadata,
                decision: "confirm" as const,
                reason: networkReason,
                shell_safety: networkShellSafety,
                safetySummary: networkShellSafety.summary,
                safetyDetails: networkShellSafety.details,
              }
            : metadata

          if (finalDecision === "block") {
            const errorMsg = shellSafety.summary
            return {
              title: "Bash Command Blocked",
              metadata: {
                output: errorMsg,
                exit: null as number | null,
                description: params.description ?? "",
                truncated: false,
                findings: security.findings,
                riskLevel: security.risk_level,
                decision: finalDecision,
                reviewApiVersion: security.review_api_version,
                reviewMode: security.review_mode,
                reviewStatus: security.review_status,
                ...(policyDecision.matchedRules.length > 0 ? { policyDecision: policyDecision.decision } : {}),
                ...(policyDecision.matchedRules.length > 0 ? { policyReason: policyDecision.reason } : {}),
                ...(matchedRules.length > 0 ? { matchedRules } : {}),
                shell_safety: shellSafety,
                safetySummary: shellSafety.summary,
                safetyDetails: shellSafety.details,
              } satisfies BashMetadata,
              output: errorMsg,
            }
          }

          yield* ask(ctx, scan, metadata)
          if (finalDecision === "confirm") {
            yield* askShellExecute(ctx, {
              patterns: [security.normalized_command || params.command],
              metadata,
            })
          }
          if (policy.needs_network_permission) {
            yield* askShellNetwork(ctx, {
              patterns: [security.normalized_command || params.command],
              metadata: networkMetadata,
            })
          }

          const env = yield* shellEnv(ctx, cwd)
          return yield* shellRunner.run(
            {
              shell,
              shellFamily: security.shell_family,
              command: params.command,
              cwd,
              env,
              timeout,
              description: params.description ?? "Shell command",
              enforcement: policy.enforcement,
              backendPreference: policy.backend_preference,
              filesystemPolicy: policy.filesystem_policy,
              allowedPaths: policy.allowed_paths,
              writablePaths: policy.writable_paths,
              networkPolicy: policy.network_policy,
              reportOnly: policy.sandbox.report_only,
              failurePolicy: policy.sandbox.failure_policy,
              riskLevel: security.risk_level,
            },
            ctx,
          ).pipe(
            Effect.map((result) => ({
              ...result,
              metadata: {
                ...result.metadata,
                findings: security.findings,
                riskLevel: security.risk_level,
                decision: finalDecision,
                reviewApiVersion: security.review_api_version,
                reviewMode: security.review_mode,
                reviewStatus: security.review_status,
                ...(policyDecision.matchedRules.length > 0 ? { policyDecision: policyDecision.decision } : {}),
                ...(policyDecision.matchedRules.length > 0 ? { policyReason: policyDecision.reason } : {}),
                ...(matchedRules.length > 0 ? { matchedRules } : {}),
                shell_safety: shellSafety,
                safetySummary: shellSafety.summary,
                safetyDetails: shellSafety.details,
              },
            })),
          )
        }),
    }
  }),
)
