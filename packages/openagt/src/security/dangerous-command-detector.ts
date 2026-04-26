/**
 * Dangerous Command Detector
 *
 * Unified security detection entry point for posix shells, cmd, and PowerShell.
 */

import { Effect, Layer, Context } from "effect"
import { Shell } from "@/shell/shell"
import {
  COMMAND_SUBSTITUTION_PATTERNS,
  BINARY_HIJACK_VARS,
  OBFUSCATED_FLAG_PATTERNS,
  hasBareShellPrefix,
  hasControlCharacters,
  hasUnicodeWhitespace,
  hasNewlines,
  containsDangerousPatterns,
  hasZshDangerousCommand,
  type DangerSeverity,
} from "./dangers"
import { ENCODED_COMMAND_PATTERNS, REMOTE_EXECUTION_PATTERNS, validatePowerShellCommand } from "./powershell"
import { parsePowerShellAst } from "./powershell-ast"

export type ShellFamily = "powershell" | "posix" | "cmd" | "unknown"

export interface DangerResult {
  allowed: boolean
  severity: DangerSeverity
  reasons: string[]
  suggestions: string[]
  shellFamily: ShellFamily
  matchedPatterns: string[]
}

export interface DangerDetectorOptions {
  strictMode?: boolean
}

interface DetectionResult {
  severity: DangerSeverity
  reasons: string[]
  patterns: string[]
}

const SEVERITY_ORDER: Record<DangerSeverity, number> = { safe: 0, low: 1, medium: 2, high: 3 }

function mergeSeverity(current: DangerSeverity, next: DangerSeverity) {
  return SEVERITY_ORDER[next] > SEVERITY_ORDER[current] ? next : current
}

function detectShellFamily(shell?: string): ShellFamily {
  if (!shell) return "unknown"
  const name = Shell.name(shell).toLowerCase()
  if (name === "powershell" || name === "pwsh") return "powershell"
  if (name === "cmd") return "cmd"
  if (["bash", "zsh", "fish", "sh", "dash", "ksh", "ash"].includes(name)) return "posix"
  return "unknown"
}

function detectBashDanger(command: string): DetectionResult {
  const reasons: string[] = []
  const patterns: string[] = []
  let severity: DangerSeverity = "safe"

  if (hasBareShellPrefix(command)) {
    reasons.push("Command starts with shell interpreter")
    patterns.push("bare_shell_prefix")
    severity = mergeSeverity(severity, "medium")
  }

  for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
    if (!pattern.test(command)) continue
    reasons.push(message)
    patterns.push(`cmd_subst:${message}`)
    severity = mergeSeverity(severity, "medium")
  }

  if (containsDangerousPatterns(command)) {
    reasons.push("Contains code execution or package manager")
    patterns.push("dangerous_pattern")
    severity = "high"
  }

  if (hasControlCharacters(command)) {
    reasons.push("Contains control characters (possible obfuscation)")
    patterns.push("control_chars")
    severity = "high"
  }

  if (hasUnicodeWhitespace(command)) {
    reasons.push("Contains unicode whitespace (possible obfuscation)")
    patterns.push("unicode_whitespace")
    severity = "high"
  }

  if (hasNewlines(command)) {
    reasons.push("Contains newline characters")
    patterns.push("newlines")
    severity = mergeSeverity(severity, "medium")
  }

  const tokens = command.trim().split(/\s+/).filter(Boolean)
  const zshDanger = hasZshDangerousCommand(tokens)
  if (zshDanger) {
    reasons.push(`Zsh dangerous command: ${zshDanger}`)
    patterns.push(`zsh_danger:${zshDanger}`)
    severity = "high"
  }

  for (const { pattern, message } of OBFUSCATED_FLAG_PATTERNS) {
    if (!pattern.test(command)) continue
    reasons.push(message)
    patterns.push(`obfuscation:${message}`)
    severity = mergeSeverity(severity, "medium")
  }

  if (/\|.*(?:sh|bash|zsh|pwsh|powershell|cmd)\b/i.test(command)) {
    reasons.push("Pipe to shell interpreter detected")
    patterns.push("pipe_to_shell")
    severity = "high"
  }

  const envVars = command.match(/\b([A-Z_][A-Z0-9_]*)=/g) || []
  for (const envVar of envVars) {
    const varName = envVar.slice(0, -1)
    if (!BINARY_HIJACK_VARS.test(varName)) continue
    reasons.push(`Dangerous environment variable: ${varName}`)
    patterns.push(`dangerous_env:${varName}`)
    severity = "high"
  }

  if (/rm\s+-rf\s+(\/|\*|~)/i.test(command)) {
    reasons.push("Dangerous recursive delete pattern")
    patterns.push("rm_rf_root")
    severity = "high"
  }

  return { severity, reasons, patterns }
}

function detectCmdDanger(command: string): DetectionResult {
  const reasons: string[] = []
  const patterns: string[] = []
  let severity: DangerSeverity = "safe"
  const normalized = command.toLowerCase()

  if (hasControlCharacters(command)) {
    reasons.push("Contains control characters (possible obfuscation)")
    patterns.push("control_chars")
    severity = "high"
  }

  if (hasUnicodeWhitespace(command)) {
    reasons.push("Contains unicode whitespace (possible obfuscation)")
    patterns.push("unicode_whitespace")
    severity = "high"
  }

  if (hasNewlines(command)) {
    reasons.push("Contains newline characters")
    patterns.push("newlines")
    severity = mergeSeverity(severity, "medium")
  }

  if (/\|\s*(?:cmd|powershell|pwsh)(?:\.exe)?\b/i.test(command)) {
    reasons.push("Pipe to shell interpreter detected")
    patterns.push("pipe_to_shell")
    severity = "high"
  }

  const cmdPatterns: Array<{ pattern: RegExp; reason: string; severity: DangerSeverity; patternKey: string }> = [
    {
      pattern: /\bdel(?:\.exe)?\s+.*(?:\/s).*?(?:\\\*|\*|\\windows\\|\\users\\)/i,
      reason: "Recursive delete via del",
      severity: "high",
      patternKey: "cmd_delete",
    },
    {
      pattern: /\brmdir(?:\.exe)?\s+.*(?:\/s).*?(?:\\\*|\*|\\windows\\|\\users\\)/i,
      reason: "Recursive directory delete via rmdir",
      severity: "high",
      patternKey: "cmd_rmdir",
    },
    {
      pattern: /\breg(?:\.exe)?\s+(?:add|delete)\b/i,
      reason: "Registry modification command",
      severity: "medium",
      patternKey: "cmd_reg",
    },
    {
      pattern: /\bsc(?:\.exe)?\s+(?:create|config|delete)\b/i,
      reason: "Service control command",
      severity: "medium",
      patternKey: "cmd_service",
    },
    {
      pattern: /\bschtasks(?:\.exe)?\s+\/create\b/i,
      reason: "Scheduled task creation",
      severity: "high",
      patternKey: "cmd_schtasks",
    },
    {
      pattern: /\brunas(?:\.exe)?\b/i,
      reason: "Privilege escalation command",
      severity: "high",
      patternKey: "cmd_runas",
    },
    {
      pattern: /\b(?:powershell|pwsh)(?:\.exe)?\s+-enc(?:odedcommand)?\b/i,
      reason: "Encoded PowerShell command launched from cmd",
      severity: "high",
      patternKey: "cmd_ps_encoded",
    },
  ]

  for (const item of cmdPatterns) {
    if (!item.pattern.test(command)) continue
    reasons.push(item.reason)
    patterns.push(item.patternKey)
    severity = mergeSeverity(severity, item.severity)
  }

  if (normalized.includes("&&") || normalized.includes("||")) {
    reasons.push("Chained cmd execution")
    patterns.push("cmd_chain")
    severity = mergeSeverity(severity, "medium")
  }

  return { severity, reasons, patterns }
}

function detectPowerShellDanger(command: string): DetectionResult {
  const reasons: string[] = []
  const patterns: string[] = []
  let severity: DangerSeverity = "safe"

  const psResult = validatePowerShellCommand(command)
  if (!psResult.valid) {
    for (const check of psResult.checks) {
      reasons.push(check.message || check.cmdlet)
      patterns.push(`ps:${check.cmdlet}`)
      severity = mergeSeverity(severity, check.severity)
    }
  }

  const astResult = parsePowerShellAst(command)
  for (const node of astResult.dangerousNodes) {
    reasons.push(node.reason)
    patterns.push(`ast:${node.nodeType}`)
    severity = mergeSeverity(severity, node.severity)
  }

  for (const { pattern, message } of ENCODED_COMMAND_PATTERNS) {
    if (!pattern.test(command)) continue
    reasons.push(message)
    patterns.push(`encoded:${message}`)
    severity = "high"
  }

  for (const { pattern, message } of REMOTE_EXECUTION_PATTERNS) {
    if (!pattern.test(command)) continue
    reasons.push(message)
    patterns.push(`remote:${message}`)
    severity = mergeSeverity(severity, "medium")
  }

  return { severity, reasons, patterns }
}

function generateSuggestions(reasons: string[], severity: DangerSeverity): string[] {
  const suggestions: string[] = []

  if (severity === "high") {
    suggestions.push("Review the command manually before execution")
    suggestions.push("Consider breaking the command into smaller, safer operations")
  }

  if (reasons.some((reason) => reason.includes("Pipe to shell"))) {
    suggestions.push("Download script first, review content, then execute")
    suggestions.push("Use --download-only flag if available")
  }

  if (reasons.some((reason) => reason.includes("control characters") || reason.includes("unicode"))) {
    suggestions.push("Remove unexpected characters from the command")
  }

  if (reasons.some((reason) => reason.toLowerCase().includes("encoded"))) {
    suggestions.push("Use decoded command for transparency")
  }

  if (reasons.some((reason) => /rundll32|regsvr32|mshta/i.test(reason))) {
    suggestions.push("This is a 'living off the land' technique often used by malware")
    suggestions.push("Ensure the DLL or script source is trusted")
  }

  return suggestions
}

function combineDetections(...detections: DetectionResult[]) {
  const reasons: string[] = []
  const patterns: string[] = []
  let severity: DangerSeverity = "safe"

  for (const detection of detections) {
    severity = mergeSeverity(severity, detection.severity)
    reasons.push(...detection.reasons)
    patterns.push(...detection.patterns)
  }

  return {
    severity,
    reasons: [...new Set(reasons)],
    patterns: [...new Set(patterns)],
  }
}

export function detect(command: string, shell?: string, options?: DangerDetectorOptions): DangerResult {
  const shellFamily = detectShellFamily(shell)
  const detection =
    shellFamily === "powershell"
      ? detectPowerShellDanger(command)
      : shellFamily === "cmd"
        ? detectCmdDanger(command)
        : shellFamily === "posix"
          ? detectBashDanger(command)
          : combineDetections(detectBashDanger(command), detectPowerShellDanger(command), detectCmdDanger(command))

  const allowed = detection.severity === "high" ? false : detection.severity === "medium" ? !options?.strictMode : true

  return {
    allowed,
    severity: detection.severity,
    reasons: detection.reasons,
    suggestions: generateSuggestions(detection.reasons, detection.severity),
    shellFamily,
    matchedPatterns: detection.patterns,
  }
}

export function isAllowed(command: string, shell?: string, options?: DangerDetectorOptions): boolean {
  return detect(command, shell, options).allowed
}

export function getSeverity(command: string, shell?: string): DangerSeverity {
  return detect(command, shell).severity
}

export function explain(command: string, shell?: string): string[] {
  return detect(command, shell).reasons
}

export interface Interface {
  readonly detect: (command: string, shell?: string, options?: DangerDetectorOptions) => Effect.Effect<DangerResult>
  readonly isAllowed: (command: string, shell?: string, options?: DangerDetectorOptions) => Effect.Effect<boolean>
  readonly getSeverity: (command: string, shell?: string) => Effect.Effect<DangerSeverity>
  readonly explain: (command: string, shell?: string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DangerDetector") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const detectEff = Effect.fn("DangerDetector.detect")(function* (
      command: string,
      shell?: string,
      options?: DangerDetectorOptions,
    ) {
      return detect(command, shell, options)
    })

    const isAllowedEff = Effect.fn("DangerDetector.isAllowed")(function* (
      command: string,
      shell?: string,
      options?: DangerDetectorOptions,
    ) {
      return isAllowed(command, shell, options)
    })

    const getSeverityEff = Effect.fn("DangerDetector.getSeverity")(function* (command: string, shell?: string) {
      return getSeverity(command, shell)
    })

    const explainEff = Effect.fn("DangerDetector.explain")(function* (command: string, shell?: string) {
      return explain(command, shell)
    })

    return Service.of({
      detect: detectEff,
      isAllowed: isAllowedEff,
      getSeverity: getSeverityEff,
      explain: explainEff,
    })
  }),
)

export const defaultLayer = layer

export * as DangerDetector from "./dangerous-command-detector"
