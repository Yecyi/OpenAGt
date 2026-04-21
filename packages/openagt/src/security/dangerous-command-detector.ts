/**
 * Dangerous Command Detector
 *
 * Unified security detection entry point that integrates:
 * - Bash/Danger patterns from dangers.ts
 * - PowerShell cmdlet detection from powershell.ts
 * - Shell classification and risk assessment from shell-security.ts
 *
 * Provides a single interface for command security analysis.
 */

import { Effect, Layer, Context } from "effect"
import { Shell } from "@/shell/shell"
import {
  COMMAND_SUBSTITUTION_PATTERNS,
  BINARY_HIJACK_VARS,
  SAFE_ENV_VARS,
  BARE_SHELL_PREFIXES,
  ZSH_DANGEROUS_COMMANDS,
  DANGEROUS_BASH_PATTERNS,
  OBFUSCATED_FLAG_PATTERNS,
  hasBareShellPrefix,
  hasControlCharacters,
  hasUnicodeWhitespace,
  hasNewlines,
  containsDangerousPatterns,
  hasZshDangerousCommand,
  CONTROL_CHAR_RE,
  UNICODE_WHITESPACE_RE,
  type DangerSeverity,
} from "./dangers"
import {
  DANGEROUS_CMDLETS,
  HIGH_SEVERITY_CMDLETS,
  ENCODED_COMMAND_PATTERNS,
  REMOTE_EXECUTION_PATTERNS,
  containsDangerousCmdlets,
  containsHighSeverityCmdlets,
  validatePowerShellCommand,
  getDangerousCmdletSummary,
} from "./powershell"
import { commandClassifier } from "./command-classifier"
import { WrapperStripper } from "./wrapper-stripper"

// ============================================================
// Types
// ============================================================

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
  allowNetwork?: boolean
  allowPrivilegeEscalation?: boolean
}

// ============================================================
// Shell Family Detection
// ============================================================

function detectShellFamily(shell?: string): ShellFamily {
  if (!shell) return "unknown"
  const name = Shell.name(shell).toLowerCase()
  if (name === "powershell" || name === "pwsh") return "powershell"
  if (name === "cmd") return "cmd"
  if (["bash", "zsh", "fish", "sh", "dash", "ksh", "ash"].includes(name)) return "posix"
  return "unknown"
}

// ============================================================
// Bash/Danger Pattern Detection
// ============================================================

interface BashDetectionResult {
  severity: DangerSeverity
  reasons: string[]
  patterns: string[]
}

function detectBashDanger(command: string): BashDetectionResult {
  const reasons: string[] = []
  const patterns: string[] = []
  let severity: DangerSeverity = "safe"

  // Check for bare shell prefixes (medium risk)
  if (hasBareShellPrefix(command)) {
    reasons.push("Command starts with shell interpreter")
    patterns.push("bare_shell_prefix")
    if (severity === "safe") severity = "medium"
  }

  // Check for command substitution patterns
  for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
    if (pattern.test(command)) {
      reasons.push(message)
      patterns.push(`cmd_subst:${message}`)
      if (severity !== "high") severity = "medium"
    }
  }

  // Check for dangerous bash patterns
  if (containsDangerousPatterns(command)) {
    reasons.push("Contains code execution or package manager")
    patterns.push("dangerous_pattern")
    if (severity !== "high") severity = "high"
  }

  // Check for control characters
  if (hasControlCharacters(command)) {
    reasons.push("Contains control characters (possible obfuscation)")
    patterns.push("control_chars")
    severity = "high"
  }

  // Check for unicode whitespace
  if (hasUnicodeWhitespace(command)) {
    reasons.push("Contains unicode whitespace (possible obfuscation)")
    patterns.push("unicode_whitespace")
    severity = "high"
  }

  // Check for newlines
  if (hasNewlines(command)) {
    reasons.push("Contains newline characters")
    patterns.push("newlines")
    if (severity === "safe") severity = "medium"
  }

  // Check for zsh dangerous commands
  const tokens = command.trim().split(/\s+/)
  const zshDanger = hasZshDangerousCommand(tokens)
  if (zshDanger) {
    reasons.push(`Zsh dangerous command: ${zshDanger}`)
    patterns.push(`zsh_danger:${zshDanger}`)
    severity = "high"
  }

  // Check for obfuscated flags
  for (const { pattern, message } of OBFUSCATED_FLAG_PATTERNS) {
    if (pattern.test(command)) {
      reasons.push(message)
      patterns.push(`obfuscation:${message}`)
      if (severity !== "high") severity = "medium"
    }
  }

  // Check for pipe to shell (curl | bash style)
  if (/\|.*(?:sh|bash|zsh|pwsh|powershell|cmd)\b/i.test(command)) {
    reasons.push("Pipe to shell interpreter detected")
    patterns.push("pipe_to_shell")
    severity = "high"
  }

  // Check for dangerous environment variables
  const envVars = command.match(/\b([A-Z_][A-Z0-9_]*)=/g) || []
  for (const envVar of envVars) {
    const varName = envVar.slice(0, -1)
    if (BINARY_HIJACK_VARS.test(varName)) {
      reasons.push(`Dangerous environment variable: ${varName}`)
      patterns.push(`dangerous_env:${varName}`)
      severity = "high"
    }
  }

  // Check for dangerous redirections
  if (/rm\s+-rf\s+(\/|\*|~)/i.test(command)) {
    reasons.push("Dangerous recursive delete pattern")
    patterns.push("rm_rf_root")
    severity = "high"
  }

  return { severity, reasons, patterns }
}

// ============================================================
// PowerShell Detection
// ============================================================

function detectPowerShellDanger(command: string): BashDetectionResult {
  const reasons: string[] = []
  const patterns: string[] = []
  let severity: DangerSeverity = "safe"

  // Use existing PowerShell validation
  const psResult = validatePowerShellCommand(command)

  if (!psResult.valid) {
    for (const check of psResult.checks) {
      reasons.push(check.message || check.cmdlet)
      patterns.push(`ps:${check.cmdlet}`)
    }
    severity = psResult.severity
  }

  // Check for encoded commands
  for (const { pattern, message } of ENCODED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      reasons.push(message)
      patterns.push(`encoded:${message}`)
      severity = "high"
    }
  }

  // Check for remote execution
  for (const { pattern, message } of REMOTE_EXECUTION_PATTERNS) {
    if (pattern.test(command)) {
      reasons.push(message)
      patterns.push(`remote:${message}`)
      if (severity !== "high") severity = "medium"
    }
  }

  // Check for AMSI bypass attempts
  if (/\[Ref\]\.Assembly\.GetType/i.test(command)) {
    reasons.push("AMSI bypass attempt")
    patterns.push("amsi_bypass")
    severity = "high"
  }

  // Check for rundll32 (living off the land)
  if (/rundll32\.exe/i.test(command)) {
    reasons.push("rundll32 execution (living off the land)")
    patterns.push("rundll32")
    severity = "high"
  }

  // Check for regsvr32 (living off the land)
  if (/regsvr32\.exe/i.test(command)) {
    reasons.push("regsvr32 execution (living off the land)")
    patterns.push("regsvr32")
    severity = "high"
  }

  // Check for mshta (living off the land)
  if (/mshta\.exe/i.test(command)) {
    reasons.push("mshta execution (living off the land)")
    patterns.push("mshta")
    severity = "high"
  }

  return { severity, reasons, patterns }
}

// ============================================================
// Suggestions Generator
// ============================================================

function generateSuggestions(reasons: string[], severity: DangerSeverity): string[] {
  const suggestions: string[] = []

  if (severity === "high") {
    suggestions.push("Review the command manually before execution")
    suggestions.push("Consider breaking the command into smaller, safer operations")
  }

  if (reasons.some((r) => r.includes("Pipe to shell"))) {
    suggestions.push("Download script first, review content, then execute")
    suggestions.push("Use --download-only flag if available")
  }

  if (reasons.some((r) => r.includes("control characters") || r.includes("unicode"))) {
    suggestions.push("Remove unexpected characters from the command")
  }

  if (reasons.some((r) => r.includes("encoded"))) {
    suggestions.push("Use decoded command for transparency")
  }

  if (reasons.some((r) => r.includes("rundll32") || r.includes("regsvr32") || r.includes("mshta"))) {
    suggestions.push("This is a 'living off the land' technique often used by malware")
    suggestions.push("Ensure the DLL/hta source is trusted")
  }

  return suggestions
}

// ============================================================
// Main Detection Function
// ============================================================

export function detect(command: string, shell?: string, options?: DangerDetectorOptions): DangerResult {
  const shellFamily = detectShellFamily(shell)
  let severity: DangerSeverity = "safe"
  const reasons: string[] = []
  const matchedPatterns: string[] = []

  // Detect based on shell family
  if (shellFamily === "powershell" || shellFamily === "cmd") {
    const psResult = detectPowerShellDanger(command)
    severity = psResult.severity
    reasons.push(...psResult.reasons)
    matchedPatterns.push(...psResult.patterns)
  } else if (shellFamily === "posix") {
    const bashResult = detectBashDanger(command)
    severity = bashResult.severity
    reasons.push(...bashResult.reasons)
    matchedPatterns.push(...bashResult.patterns)
  } else {
    // Unknown shell - check both
    const bashResult = detectBashDanger(command)
    const psResult = detectPowerShellDanger(command)

    // Take highest severity
    const severityOrder: Record<DangerSeverity, number> = { safe: 0, low: 1, medium: 2, high: 3 }
    if (severityOrder[bashResult.severity] >= severityOrder[severity]) {
      severity = bashResult.severity
      reasons.push(...bashResult.reasons)
      matchedPatterns.push(...bashResult.patterns)
    }
    if (severityOrder[psResult.severity] >= severityOrder[severity]) {
      severity = psResult.severity
      reasons.push(...psResult.reasons)
      matchedPatterns.push(...psResult.patterns)
    }
  }

  // Determine if allowed based on severity and options
  let allowed = true
  if (severity === "high") {
    allowed = false
  } else if (severity === "medium") {
    allowed = options?.strictMode ? false : true
  }

  // Apply options
  if (!allowed && options?.strictMode === false) {
    // In non-strict mode, medium commands are allowed with warning
    if (severity === "medium") {
      allowed = true
    }
  }

  const suggestions = generateSuggestions(reasons, severity)

  return {
    allowed,
    severity,
    reasons: [...new Set(reasons)], // Deduplicate
    suggestions,
    shellFamily,
    matchedPatterns: [...new Set(matchedPatterns)],
  }
}

/**
 * Quick check if a command is allowed
 */
export function isAllowed(command: string, shell?: string, options?: DangerDetectorOptions): boolean {
  return detect(command, shell, options).allowed
}

/**
 * Get severity of a command
 */
export function getSeverity(command: string, shell?: string): DangerSeverity {
  return detect(command, shell).severity
}

/**
 * Explain why a command is flagged
 */
export function explain(command: string, shell?: string): string[] {
  return detect(command, shell).reasons
}

// ============================================================
// Effect-based Service
// ============================================================

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
