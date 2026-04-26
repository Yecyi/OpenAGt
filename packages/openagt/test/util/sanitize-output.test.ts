import { describe, expect, test } from "bun:test"
import { sanitizeTerminalOutput } from "../../src/util/sanitize-output"

describe("sanitizeTerminalOutput", () => {
  test("removes OSC clipboard and screen-control sequences", () => {
    expect(sanitizeTerminalOutput("ok\x1b]52;c;SGVsbG8=\x07\x1b[2Jdone")).toBe("okdone")
  })
})

