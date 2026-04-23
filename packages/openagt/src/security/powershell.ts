/**
 * PowerShell Security Module
 *
 * Comprehensive dangerous cmdlet detection based on Claude Code's dangerousCmdlets.ts.
 * Detects PowerShell commands that can execute arbitrary code, escalate privileges,
 * or perform other dangerous system operations.
 *
 * Reference: Code Reference/CC Source Code/src/utils/powershell/dangerousCmdlets.ts
 */

import { STRUCTURED_DANGEROUS_CMDLETS } from "./powershell-ast"

/**
 * Dangerous PowerShell cmdlets that can execute arbitrary code.
 * Consolidated from powershell-ast.ts STRUCTURED_DANGEROUS_CMDLETS for backward compatibility.
 */
export const DANGEROUS_CMDLETS = Object.keys(STRUCTURED_DANGEROUS_CMDLETS)

/**
 * High-severity cmdlets that require extra caution
 */
export const HIGH_SEVERITY_CMDLETS = Object.entries(STRUCTURED_DANGEROUS_CMDLETS)
  .filter(([, info]) => info.severity === "high")
  .map(([cmdlet]) => cmdlet)

/**
 * Patterns for encoded/base64 PowerShell commands
 */
export const ENCODED_COMMAND_PATTERNS = [
  { pattern: /-enc(?:odedCommand)?\s+\S+/i, message: "Encoded PowerShell command" },
  { pattern: /-e(?:xec)?\s+\S+/i, message: "Encoded command (short flag)" },
  { pattern: /FromBase64String/i, message: "Base64 decoded command" },
] as const

/**
 * Patterns for remote execution attempts
 */
export const REMOTE_EXECUTION_PATTERNS = [
  { pattern: /Enter-PSSession/i, message: "PowerShell remoting PSSession" },
  { pattern: /New-PSSession/i, message: "PowerShell remoting PSSession creation" },
  { pattern: /Invoke-Command.*-ComputerName/i, message: "Remote command execution" },
  { pattern: /-ComputerName\s+\S+/i, message: "Remote computer target" },
  { pattern: /-Session\s+\S+/i, message: "Remote Session target" },
  { pattern: /-RemoteServer\s+\S+/i, message: "Remote server target" },
] as const

export type DangerSeverity = "high" | "medium" | "low" | "safe"

export interface CmdletCheck {
  cmdlet: string
  matched: boolean
  severity: DangerSeverity
  message?: string
}

export interface CmdletValidationResult {
  valid: boolean
  severity: DangerSeverity
  checks: CmdletCheck[]
}

/**
 * Pre-computed uppercase versions for efficient O(1) lookup
 */
const UPPER_DANGEROUS_CMDLETS = DANGEROUS_CMDLETS.map((c) => c.toUpperCase())
const UPPER_HIGH_SEVERITY_CMDLETS = HIGH_SEVERITY_CMDLETS.map((c) => c.toUpperCase())

/**
 * Check if a PowerShell command contains dangerous cmdlets.
 * Uses word-boundary regex to avoid false positives from substring matches
 * (e.g., "Invoke-WebRequest" should not trigger on the substring "webrequest").
 */
export function containsDangerousCmdlets(command: string): boolean {
  const upperCommand = command.toUpperCase()
  return UPPER_DANGEROUS_CMDLETS.some((cmdlet) => {
    const escaped = cmdlet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`\\b${escaped}\\b`, "i").test(upperCommand)
  })
}

/**
 * Check if a PowerShell command contains high-severity cmdlets.
 * Uses word-boundary regex to avoid false positives.
 */
export function containsHighSeverityCmdlets(command: string): boolean {
  const upperCommand = command.toUpperCase()
  return UPPER_HIGH_SEVERITY_CMDLETS.some((cmdlet) => {
    const escaped = cmdlet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`\\b${escaped}\\b`, "i").test(upperCommand)
  })
}

/**
 * Validate a PowerShell command and return detailed check results
 */
export function validatePowerShellCommand(command: string): CmdletValidationResult {
  const checks: CmdletCheck[] = []
  let highestSeverity: DangerSeverity = "safe"
  const upperCommand = command.toUpperCase()

  // Check for dangerous cmdlets
  for (let i = 0; i < DANGEROUS_CMDLETS.length; i++) {
    const cmdlet = DANGEROUS_CMDLETS[i]!
    const upperCmdlet = UPPER_DANGEROUS_CMDLETS[i]!
    const matched = upperCommand.includes(upperCmdlet)
    const isHighSeverity = UPPER_HIGH_SEVERITY_CMDLETS.includes(upperCmdlet)
    const severity: DangerSeverity = isHighSeverity ? "high" : "medium"

    if (matched && severity === "high") {
      highestSeverity = "high"
    } else if (matched && highestSeverity !== "high") {
      highestSeverity = severity
    }

    checks.push({
      cmdlet,
      matched,
      severity: matched ? severity : "safe",
      message: matched ? `Dangerous cmdlet detected: ${cmdlet}` : undefined,
    })
  }

  // Check for encoded commands
  for (const { pattern, message } of ENCODED_COMMAND_PATTERNS) {
    const matched = pattern.test(command)
    if (matched) {
      highestSeverity = "high"
    }
    checks.push({
      cmdlet: "encoded_command",
      matched,
      severity: matched ? "high" : "safe",
      message: matched ? message : undefined,
    })
  }

  // Check for remote execution
  for (const { pattern, message } of REMOTE_EXECUTION_PATTERNS) {
    const matched = pattern.test(command)
    if (matched && highestSeverity !== "high") {
      highestSeverity = "medium"
    }
    checks.push({
      cmdlet: "remote_execution",
      matched,
      severity: matched ? "medium" : "safe",
      message: matched ? message : undefined,
    })
  }

  return {
    valid: highestSeverity === "safe",
    severity: highestSeverity,
    checks: checks.filter((c) => c.matched),
  }
}

/**
 * Get a human-readable summary of dangerous cmdlets in a command
 */
export function getDangerousCmdletSummary(command: string): string | null {
  const result = validatePowerShellCommand(command)
  if (result.valid) return null

  const matched = result.checks.filter((c) => c.matched)
  const highSeverity = matched.filter((c) => c.severity === "high")
  const mediumSeverity = matched.filter((c) => c.severity === "medium")

  const parts: string[] = []
  if (highSeverity.length > 0) {
    parts.push(`HIGH: ${highSeverity.map((c) => c.message || c.cmdlet).join(", ")}`)
  }
  if (mediumSeverity.length > 0) {
    parts.push(`MEDIUM: ${mediumSeverity.map((c) => c.message || c.cmdlet).join(", ")}`)
  }

  return parts.join(" | ")
}
