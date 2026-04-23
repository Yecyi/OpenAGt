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

type DangerEntry = {
  display: string
  severity: "high" | "medium"
  message: string
  pattern: RegExp
}

const STRUCTURED_DISPLAY_NAMES: Record<string, string> = {
  "invoke-expression": "Invoke-Expression",
  iex: "iex",
  "invoke-command": "Invoke-Command",
  "invoke-webrequest": "Invoke-WebRequest",
  iwr: "iwr",
  "invoke-restmethod": "Invoke-RestMethod",
  "start-process": "Start-Process",
  "new-service": "New-Service",
  "set-service": "Set-Service",
  "register-scheduledtask": "Register-ScheduledTask",
  "schtasks.exe": "schtasks.exe",
  "set-executionpolicy": "Set-ExecutionPolicy",
  "new-item": "New-Item",
  "remove-item": "Remove-Item",
  "convertto-securestring": "ConvertTo-SecureString",
  "convertfrom-securestring": "ConvertFrom-SecureString",
  "get-content": "Get-Content",
  "set-content": "Set-Content",
  "out-file": "Out-File",
  "add-type": "Add-Type",
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const STRUCTURED_ENTRIES = Object.entries(STRUCTURED_DANGEROUS_CMDLETS).map(([cmdlet, info]) => ({
  display: STRUCTURED_DISPLAY_NAMES[cmdlet] ?? cmdlet,
  severity: info.severity,
  message: `Dangerous cmdlet detected: ${STRUCTURED_DISPLAY_NAMES[cmdlet] ?? cmdlet}`,
  pattern: new RegExp(`\\b${escapeRegex(cmdlet)}\\b`, "i"),
})) satisfies DangerEntry[]

const SPECIAL_ENTRIES = [
  {
    display: "Start-Process -Verb RunAs",
    severity: "high",
    message: "Privilege escalation via Start-Process -Verb RunAs",
    pattern: /\bstart-process\b(?:(?!\bstart-process\b)[\s\S])*\b-verb\s+runas\b/i,
  },
  {
    display: "runas.exe",
    severity: "high",
    message: "Privilege escalation via runas.exe",
    pattern: /\brunas(?:\.exe)?\b/i,
  },
  {
    display: "sudo",
    severity: "high",
    message: "Privilege escalation via sudo",
    pattern: /\bsudo\b/i,
  },
  {
    display: "powershell -enc",
    severity: "high",
    message: "Encoded PowerShell command",
    pattern: /\b(?:powershell|pwsh)(?:\.exe)?\s+-enc\b/i,
  },
  {
    display: "powershell -EncodedCommand",
    severity: "high",
    message: "Encoded PowerShell command",
    pattern: /\b(?:powershell|pwsh)(?:\.exe)?\s+-encodedcommand\b/i,
  },
  {
    display: "Get-WmiObject",
    severity: "medium",
    message: "Dangerous cmdlet detected: Get-WmiObject",
    pattern: /\bget-wmiobject\b/i,
  },
] satisfies DangerEntry[]

const DANGEROUS_CMDLET_ENTRIES = [...STRUCTURED_ENTRIES, ...SPECIAL_ENTRIES]

/**
 * Dangerous PowerShell cmdlets and escalation patterns.
 */
export const DANGEROUS_CMDLETS = [...new Set(DANGEROUS_CMDLET_ENTRIES.map((entry) => entry.display))]

/**
 * High-severity cmdlets that require extra caution.
 */
export const HIGH_SEVERITY_CMDLETS = [
  ...new Set(DANGEROUS_CMDLET_ENTRIES.filter((entry) => entry.severity === "high").map((entry) => entry.display)),
]

/**
 * Check if a PowerShell command contains dangerous cmdlets.
 */
export function containsDangerousCmdlets(command: string): boolean {
  return DANGEROUS_CMDLET_ENTRIES.some((entry) => entry.pattern.test(command))
}

/**
 * Check if a PowerShell command contains high-severity cmdlets.
 */
export function containsHighSeverityCmdlets(command: string): boolean {
  return DANGEROUS_CMDLET_ENTRIES.some((entry) => entry.severity === "high" && entry.pattern.test(command))
}

/**
 * Validate a PowerShell command and return detailed check results
 */
export function validatePowerShellCommand(command: string): CmdletValidationResult {
  const checks: CmdletCheck[] = []
  let highestSeverity: DangerSeverity = "safe"

  for (const entry of DANGEROUS_CMDLET_ENTRIES) {
    const matched = entry.pattern.test(command)
    checks.push({
      cmdlet: entry.display,
      matched,
      severity: matched ? entry.severity : "safe",
      message: matched ? entry.message : undefined,
    })
    if (matched) highestSeverity = highestSeverity === "high" ? "high" : entry.severity
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
