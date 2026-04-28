import { describe, expect, test } from "bun:test"
import { EnvSanitizer } from "../../src/security/env-sanitizer"

describe("EnvSanitizer", () => {
  test("skips undefined values while keeping safe vars", () => {
    const sanitized = new EnvSanitizer({
      LANG: "en_US.UTF-8",
      FORCE_COLOR: "1",
      TZ: undefined,
      PATH: "C:\\temp\\bin",
      NODE_OPTIONS: "--require=C:\\temp\\evil.js",
      BASH_ENV: "/tmp/pwn",
      ANTHROPIC_API_KEY: "secret",
      GITHUB_TOKEN: "secret",
    }).sanitize()

    expect(sanitized).toEqual({
      LANG: "en_US.UTF-8",
      FORCE_COLOR: "1",
    })
  })

  test("reports dangerous shell env variables separately from default drops", () => {
    const dangerous = new EnvSanitizer({
      NODE_OPTIONS: "--require=/tmp/evil.js",
      PYTHONPATH: "/tmp",
      LANG: "en_US.UTF-8",
      CUSTOM_VAR: "value",
    }).getDangerousVars()

    expect(dangerous).toContainEqual({
      key: "NODE_OPTIONS",
      reason: "dangerous shell environment variable (NODE_OPTIONS)",
    })
    expect(dangerous).toContainEqual({
      key: "PYTHONPATH",
      reason: "dangerous shell environment variable (PYTHONPATH)",
    })
    expect(dangerous).toContainEqual({ key: "CUSTOM_VAR", reason: "not in whitelist" })
  })
})
