// Shell-specific scans used by the dangerous command detector.
// This file returns severity, reasons, and pattern keys; it does not format public results.

import type { DangerSeverity } from "./danger-contracts"
import { BINARY_HIJACK_VARS } from "./danger-env"
import {
  containsDangerousPatterns,
  hasBareShellPrefix,
  hasControlCharacters,
  hasNewlines,
  hasUnicodeWhitespace,
  hasZshDangerousCommand,
} from "./danger-helpers"
import type { DetectionResult } from "./danger-detector-contracts"
import { COMMAND_SUBSTITUTION_PATTERNS, OBFUSCATED_FLAG_PATTERNS } from "./danger-patterns"
import { parsePowerShellAst } from "./powershell-ast"
import { ENCODED_COMMAND_PATTERNS, REMOTE_EXECUTION_PATTERNS, validatePowerShellCommand } from "./powershell"

const SEVERITY_ORDER: Record<DangerSeverity, number> = { safe: 0, low: 1, medium: 2, high: 3 }
const DESTRUCTIVE_RM_PATTERN =
  /\brm\b(?=[^;&|]*\s-[^\s;&|]*r)(?=[^;&|]*\s-[^\s;&|]*f)[^;&|]*(?:^|\s)(?:\/|\*|~)(?:\s|$)/i

function mergeSeverity(current: DangerSeverity, next: DangerSeverity): DangerSeverity {
  return SEVERITY_ORDER[next] > SEVERITY_ORDER[current] ? next : current
}

export function detectBashDanger(command: string): DetectionResult {
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

  if (/rm\s+-rf\s+(\/|\*|~)/i.test(command) || DESTRUCTIVE_RM_PATTERN.test(command)) {
    reasons.push("Dangerous recursive delete pattern")
    patterns.push("rm_rf_root")
    severity = "high"
  }

  return { severity, reasons, patterns }
}

export function detectCmdDanger(command: string): DetectionResult {
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

export function detectPowerShellDanger(command: string): DetectionResult {
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

export function combineDetections(...detections: DetectionResult[]): DetectionResult {
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
