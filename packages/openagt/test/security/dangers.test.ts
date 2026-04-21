import { describe, expect, test } from "bun:test"
import {
  COMMAND_SUBSTITUTION_PATTERNS,
  BINARY_HIJACK_VARS,
  SAFE_ENV_VARS,
  BARE_SHELL_PREFIXES,
  ZSH_DANGEROUS_COMMANDS,
  DANGEROUS_BASH_PATTERNS,
  OBFUSCATED_FLAG_PATTERNS,
  DANGEROUS_REDIRECTION_PATTERNS,
  hasBareShellPrefix,
  hasControlCharacters,
  hasUnicodeWhitespace,
  hasNewlines,
  containsDangerousPatterns,
  hasZshDangerousCommand,
  CONTROL_CHAR_RE,
  UNICODE_WHITESPACE_RE,
  BASH_SECURITY_CHECK_IDS,
} from "../../src/security/dangers"

/**
 * Security Dangers Module Tests
 *
 * Tests for dangerous pattern detection, command classification,
 * and security checks based on CC Source Code's bashSecurity.ts.
 */

describe("command substitution patterns", () => {
  test("detects process substitution <()", () => {
    const cmd = "cat <(ls)"
    const found = COMMAND_SUBSTITUTION_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("process substitution")
  })

  test("detects process substitution >()", () => {
    const cmd = "diff <(ls) <(ls -l)"
    const matches = COMMAND_SUBSTITUTION_PATTERNS.filter((p) => p.pattern.test(cmd))
    expect(matches.length).toBeGreaterThan(0)
  })

  test("detects $() command substitution", () => {
    const cmd = "$(echo hello)"
    const found = COMMAND_SUBSTITUTION_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("$() command substitution")
  })

  test("detects ${} parameter substitution", () => {
    const cmd = "${HOME}/bin"
    const found = COMMAND_SUBSTITUTION_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("${} parameter substitution")
  })

  test("detects legacy $[] arithmetic expansion", () => {
    const cmd = "echo $[1+2]"
    const found = COMMAND_SUBSTITUTION_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("$[]")
  })

  test("detects PowerShell comment syntax", () => {
    const cmd = "<# comment #>"
    const found = COMMAND_SUBSTITUTION_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("PowerShell")
  })
})

describe("environment variables", () => {
  test("binary hijack vars regex matches dangerous patterns", () => {
    expect(BINARY_HIJACK_VARS.test("LD_PRELOAD")).toBe(true)
    expect(BINARY_HIJACK_VARS.test("LD_LIBRARY_PATH")).toBe(true)
    expect(BINARY_HIJACK_VARS.test("DYLD_INSERT_LIBRARIES")).toBe(true)
    expect(BINARY_HIJACK_VARS.test("PATH")).toBe(true)
    expect(BINARY_HIJACK_VARS.test("HOME")).toBe(false)
    expect(BINARY_HIJACK_VARS.test("USER")).toBe(false)
  })

  test("safe env vars whitelist contains expected keys", () => {
    expect(SAFE_ENV_VARS.has("TERM")).toBe(true)
    expect(SAFE_ENV_VARS.has("LANG")).toBe(true)
    expect(SAFE_ENV_VARS.has("HOME")).toBe(false) // Not explicitly allowed
  })
})

describe("bare shell prefixes", () => {
  test("detects common shell interpreters", () => {
    expect(BARE_SHELL_PREFIXES.has("bash")).toBe(true)
    expect(BARE_SHELL_PREFIXES.has("zsh")).toBe(true)
    expect(BARE_SHELL_PREFIXES.has("sh")).toBe(true)
    expect(BARE_SHELL_PREFIXES.has("fish")).toBe(true)
    expect(BARE_SHELL_PREFIXES.has("pwsh")).toBe(true)
    expect(BARE_SHELL_PREFIXES.has("powershell")).toBe(true)
  })

  test("detects command wrappers", () => {
    expect(BARE_SHELL_PREFIXES.has("sudo")).toBe(true)
    expect(BARE_SHELL_PREFIXES.has("env")).toBe(true)
    expect(BARE_SHELL_PREFIXES.has("xargs")).toBe(true)
    expect(BARE_SHELL_PREFIXES.has("nohup")).toBe(true)
  })

  test("hasBareShellPrefix works correctly", () => {
    expect(hasBareShellPrefix("bash -c 'echo hello'")).toBe(true)
    expect(hasBareShellPrefix("git status")).toBe(false)
    expect(hasBareShellPrefix("ls -la")).toBe(false)
  })
})

describe("zsh dangerous commands", () => {
  test("contains zsh module loading commands", () => {
    expect(ZSH_DANGEROUS_COMMANDS.has("zmodload")).toBe(true)
    expect(ZSH_DANGEROUS_COMMANDS.has("emulate")).toBe(true)
  })

  test("contains zsh file manipulation commands", () => {
    expect(ZSH_DANGEROUS_COMMANDS.has("zf_rm")).toBe(true)
    expect(ZSH_DANGEROUS_COMMANDS.has("zf_mv")).toBe(true)
    expect(ZSH_DANGEROUS_COMMANDS.has("zf_ln")).toBe(true)
  })

  test("hasZshDangerousCommand detects dangerous commands", () => {
    expect(hasZshDangerousCommand(["cat", "zmodload", "file.txt"])).toBe("zmodload")
    expect(hasZshDangerousCommand(["ls", "grep"])).toBeNull()
  })
})

describe("dangerous bash patterns", () => {
  test("contains code execution interpreters", () => {
    expect(DANGEROUS_BASH_PATTERNS).toContain("python")
    expect(DANGEROUS_BASH_PATTERNS).toContain("node")
    expect(DANGEROUS_BASH_PATTERNS).toContain("ruby")
    expect(DANGEROUS_BASH_PATTERNS).toContain("perl")
  })

  test("contains package managers", () => {
    expect(DANGEROUS_BASH_PATTERNS).toContain("npm")
    expect(DANGEROUS_BASH_PATTERNS).toContain("pnpm")
    expect(DANGEROUS_BASH_PATTERNS).toContain("yarn")
    expect(DANGEROUS_BASH_PATTERNS).toContain("npx")
  })

  test("contains dangerous shell commands", () => {
    expect(DANGEROUS_BASH_PATTERNS).toContain("eval")
    expect(DANGEROUS_BASH_PATTERNS).toContain("exec")
    expect(DANGEROUS_BASH_PATTERNS).toContain("env")
  })

  test("containsDangerousPatterns detects dangerous commands", () => {
    expect(containsDangerousPatterns("npm install express")).toBe(true)
    expect(containsDangerousPatterns("python script.py")).toBe(true)
    expect(containsDangerousPatterns("git status")).toBe(false)
    expect(containsDangerousPatterns("ls -la")).toBe(false)
  })
})

describe("obfuscated flag patterns", () => {
  test("detects ANSI-C quoted strings", () => {
    const cmd = "$'\\x41\\x42'"
    const found = OBFUSCATED_FLAG_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("ANSI-C")
  })

  test("detects locale-quoted strings", () => {
    const cmd = "$'hello world'"
    // This should match the ANSI-C pattern
    const matches = OBFUSCATED_FLAG_PATTERNS.filter((p) => p.pattern.test(cmd))
    expect(matches.length).toBeGreaterThan(0)
  })

  test("detects empty quotes with dash", () => {
    const cmd = "'' --flag"
    const found = OBFUSCATED_FLAG_PATTERNS.find((p) => p.pattern.test(cmd))
    expect(found?.message).toContain("flag hiding")
  })
})

describe("control characters", () => {
  test("CONTROL_CHAR_RE detects control characters", () => {
    expect(CONTROL_CHAR_RE.test("\x00")).toBe(true)
    expect(CONTROL_CHAR_RE.test("\x07")).toBe(true) // BEL
    expect(CONTROL_CHAR_RE.test("\x1B")).toBe(true) // ESC
    expect(CONTROL_CHAR_RE.test("hello")).toBe(false)
    expect(CONTROL_CHAR_RE.test("hello\x7F")).toBe(true) // DEL
  })

  test("hasControlCharacters wrapper works", () => {
    expect(hasControlCharacters("normal text")).toBe(false)
    expect(hasControlCharacters("text\x00with\x07control")).toBe(true)
  })
})

describe("unicode whitespace", () => {
  test("UNICODE_WHITESPACE_RE detects zero-width characters", () => {
    expect(UNICODE_WHITESPACE_RE.test("\u200B")).toBe(true) // ZWSP
    expect(UNICODE_WHITESPACE_RE.test("\u200C")).toBe(true) // ZWNJ
    expect(UNICODE_WHITESPACE_RE.test("\u200D")).toBe(true) // ZWJ
    expect(UNICODE_WHITESPACE_RE.test("\uFEFF")).toBe(true) // BOM
    expect(UNICODE_WHITESPACE_RE.test("normal text")).toBe(false)
  })

  test("hasUnicodeWhitespace wrapper works", () => {
    expect(hasUnicodeWhitespace("hello\u200Bworld")).toBe(true)
    expect(hasUnicodeWhitespace("normal")).toBe(false)
  })
})

describe("newline detection", () => {
  test("hasNewlines detects newlines", () => {
    expect(hasNewlines("hello\nworld")).toBe(true)
    expect(hasNewlines("hello\r\nworld")).toBe(true)
    expect(hasNewlines("hello world")).toBe(false)
  })
})

describe("bash security check IDs", () => {
  test("all expected check IDs are defined", () => {
    expect(BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMANDS).toBe(1)
    expect(BASH_SECURITY_CHECK_IDS.JQ_SYSTEM_FUNCTION).toBe(2)
    expect(BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS).toBe(4)
    expect(BASH_SECURITY_CHECK_IDS.CONTROL_CHARACTERS).toBe(17)
    expect(BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS).toBe(20)
  })
})
