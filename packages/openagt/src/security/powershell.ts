/**
 * PowerShell Security Module
 *
 * Comprehensive dangerous cmdlet detection based on Claude Code's dangerousCmdlets.ts.
 * Detects PowerShell commands that can execute arbitrary code, escalate privileges,
 * or perform other dangerous system operations.
 *
 * Reference: Code Reference/CC Source Code/src/utils/powershell/dangerousCmdlets.ts
 */

/**
 * Dangerous PowerShell cmdlets that can execute arbitrary code
 */
export const DANGEROUS_CMDLETS = [
  // Execution policy and code execution
  "Set-ExecutionPolicy",
  "Invoke-Expression",
  "Invoke-Command",
  "Invoke-WebRequest",
  "Invoke-RestMethod",
  "iex", // Alias for Invoke-Expression
  "iwr", // Alias for Invoke-WebRequest

  // Process and service manipulation
  "Start-Process",
  "Stop-Process",
  "New-Service",
  "Set-Service",
  "Stop-Service",
  "Restart-Service",

  // Privilege escalation
  "Start-Process -Verb RunAs",
  "runas.exe",
  "sudo",

  // Credential and authentication
  "Get-Credential",
  "ConvertTo-SecureString",
  "ConvertFrom-SecureString",
  "Extract ntds", // NTDS extraction for AD
  "ntdsutil",

  // System information gathering
  "Get-Process",
  "Get-Service",
  "Get-WmiObject",
  "Get-CimInstance",
  "gwmi", // Alias for Get-WmiObject

  // Registry manipulation
  "Set-ItemProperty",
  "Remove-ItemProperty",
  "New-ItemProperty",

  // File and registry deletion
  "Clear-Content",
  "Remove-Item",
  "Remove-ItemProperty",

  // Scheduled tasks
  "schtasks.exe",
  "at.exe",
  "Register-ScheduledTask",
  "Unregister-ScheduledTask",

  // Network operations
  "New-NetFirewallRule",
  "Set-NetFirewallRule",
  "Disable-NetFirewallRule",

  // Environment variables
  "setx.exe",
  "[Environment]::SetEnvironmentVariable",

  // Script block logging bypass
  "Disable-PSRemoting",
  "Enable-PSRemoting",

  // COM object abuse
  "New-Object -ComObject",
  "Get-WmiObject -Class Win32_Process",

  // AMSI bypass
  "amsiInitFailed",
  "[Ref].Assembly.GetType",

  // DLL injection
  "rundll32.exe",

  // Certificate manipulation
  "Set-AuthenticodeSignature",

  // BITS transfer (living off the land)
  "Start-BitsTransfer",
  "bitsadmin.exe",

  // HTA and scripting
  "mshta.exe",
  "wscript.exe",
  "cscript.exe",
  "regsvr32.exe",

  // Encoded commands
  "powershell -enc",
  "powershell -EncodedCommand",
  "pwsh -enc",
  "pwsh -EncodedCommand",
] as const

/**
 * High-severity cmdlets that require extra caution
 */
export const HIGH_SEVERITY_CMDLETS = [
  "Invoke-Expression",
  "Invoke-Command",
  "Set-ExecutionPolicy",
  "Start-Process -Verb RunAs",
  "rundll32.exe",
  "regsvr32.exe",
  "mshta.exe",
  "powershell -enc",
  "powershell -EncodedCommand",
  "Extract ntds",
  "ntdsutil",
] as const

/**
 * Patterns for encoded/base64 PowerShell commands
 */
export const ENCODED_COMMAND_PATTERNS = [
  { pattern: /-enc(?:odedCommand)?\s+\S+/i, message: "Encoded PowerShell command" },
  { pattern: /-e(?:xec)?\s+\S+/i, message: "Short form encoded command" },
  { pattern: /FromBase64String/i, message: "Base64 decoded command" },
] as const

/**
 * Patterns for remote execution attempts
 */
export const REMOTE_EXECUTION_PATTERNS = [
  { pattern: /-ComputerName\s+\S+/i, message: "Remote computer target" },
  { pattern: /-Session\s+\S+/i, message: "Remote session target" },
  { pattern: /-RemoteServer\s+\S+/i, message: "Remote server target" },
  { pattern: /Enter-PSSession/i, message: "PowerShell remoting session" },
  { pattern: /New-PSSession/i, message: "PowerShell remoting session creation" },
  { pattern: /Invoke-Command.*-ComputerName/i, message: "Remote command execution" },
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
 * Check if a PowerShell command contains dangerous cmdlets
 */
export function containsDangerousCmdlets(command: string): boolean {
  const upperCommand = command.toUpperCase()
  return DANGEROUS_CMDLETS.some((cmdlet) => upperCommand.includes(cmdlet.toUpperCase()))
}

/**
 * Check if a PowerShell command contains high-severity cmdlets
 */
export function containsHighSeverityCmdlets(command: string): boolean {
  const upperCommand = command.toUpperCase()
  return HIGH_SEVERITY_CMDLETS.some((cmdlet) => upperCommand.includes(cmdlet.toUpperCase()))
}

/**
 * Validate a PowerShell command and return detailed check results
 */
export function validatePowerShellCommand(command: string): CmdletValidationResult {
  const checks: CmdletCheck[] = []
  let highestSeverity: DangerSeverity = "safe"

  // Check for dangerous cmdlets
  for (const cmdlet of DANGEROUS_CMDLETS) {
    const upperCommand = command.toUpperCase()
    const upperCmdlet = cmdlet.toUpperCase()
    const matched = upperCommand.includes(upperCmdlet)
    const severity: DangerSeverity = (HIGH_SEVERITY_CMDLETS as readonly string[]).includes(cmdlet) ? "high" : "medium"

    if (matched && severity === "high") {
      highestSeverity = "high"
    } else if (matched && highestSeverity !== "high") {
      highestSeverity = severity
    }

    checks.push({
      cmdlet,
      matched,
      severity,
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
