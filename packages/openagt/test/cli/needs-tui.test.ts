import { describe, expect, test } from "bun:test"
import { needsTuiCommands } from "../../src/cli/needs-tui"

describe("needsTuiCommands", () => {
  test("loads the default TUI for option-only launches", () => {
    expect(needsTuiCommands([])).toBe(true)
    expect(needsTuiCommands(["--pure"])).toBe(true)
    expect(needsTuiCommands(["--print-logs", "--pure"])).toBe(true)
  })

  test("skips global option values before finding non-TUI commands", () => {
    expect(needsTuiCommands(["--log-level", "DEBUG", "db", "status"])).toBe(false)
    expect(needsTuiCommands(["--log-level=DEBUG", "experts", "list"])).toBe(false)
  })

  test("keeps explicit help and version paths lightweight", () => {
    expect(needsTuiCommands(["--help"])).toBe(false)
    expect(needsTuiCommands(["-v"])).toBe(false)
  })

  test("loads TUI commands after global options", () => {
    expect(needsTuiCommands(["--pure", "."])).toBe(true)
    expect(needsTuiCommands(["--print-logs", "attach"])).toBe(true)
  })
})
