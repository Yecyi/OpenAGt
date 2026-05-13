import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  expandCommandShellBlocks,
  parseCommandArguments,
  renderCommandTemplate,
} from "../../src/session/prompt/command-template"

describe("session.prompt command template helpers", () => {
  test("parses quoted arguments and image references", () => {
    expect(parseCommandArguments(`"one two" 'three four' [Image 2] five`)).toEqual([
      "one two",
      "three four",
      "[Image 2]",
      "five",
    ])
  })

  test("replaces numeric placeholders and gives the last placeholder remaining args", () => {
    expect(renderCommandTemplate({ template: "$1 :: $2", arguments: "alpha beta gamma" })).toBe("alpha :: beta gamma")
  })

  test("appends arguments when no placeholder is present", () => {
    expect(renderCommandTemplate({ template: "explain this", arguments: "src/index.ts" })).toBe(
      "explain this\n\nsrc/index.ts",
    )
  })

  test("keeps ARGUMENTS placeholder as raw input", () => {
    expect(renderCommandTemplate({ template: "run $ARGUMENTS", arguments: `"one two"` })).toBe('run "one two"')
  })

  test("trims templates without shell blocks", async () => {
    await expect(Effect.runPromise(expandCommandShellBlocks("  hello  "))).resolves.toBe("hello")
  })
})
