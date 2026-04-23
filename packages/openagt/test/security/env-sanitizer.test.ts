import { describe, expect, test } from "bun:test"
import { EnvSanitizer } from "../../src/security/env-sanitizer"

describe("EnvSanitizer", () => {
  test("skips undefined values while keeping safe vars", () => {
    const sanitized = new EnvSanitizer({
      LANG: "en_US.UTF-8",
      TZ: undefined,
      PATH: "C:\\temp\\bin",
    }).sanitize()

    expect(sanitized).toEqual({
      LANG: "en_US.UTF-8",
    })
  })
})
