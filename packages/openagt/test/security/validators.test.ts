import { describe, expect, test } from "bun:test"
import { validateCommand } from "../../src/security/validators"
import { classifyCommand } from "../../src/security/command-classifier"

describe("security validators", () => {
  test("detects commands that start with a flag after leading whitespace", () => {
    const result = validateCommand("  -rf /")

    expect(result.behavior).toBe("ask")
    expect(result.message).toContain("starts with flag")
  })

  test("detects variables used after redirection operators", () => {
    const result = validateCommand("echo hello > $OUT")

    expect(result.behavior).toBe("ask")
    expect(result.message).toContain("Variable in dangerous context")
  })

  test("allows quoted heredoc command substitution when body has no executable substitution", () => {
    const command = "$(cat <<'EOF'\nhello\nEOF)"

    expect(validateCommand(command)).toEqual({ behavior: "allow", message: "Safe quoted heredoc" })
    expect(classifyCommand(command).riskLevel).toBe("safe")
  })

  test("asks on unquoted heredoc command substitution", () => {
    const result = validateCommand("$(cat <<EOF\nhello\nEOF)")

    expect(result.behavior).toBe("ask")
    expect(result.message).toBeTruthy()
  })

  test("asks on quoted heredoc bodies that contain executable substitution", () => {
    const result = validateCommand("$(cat <<'EOF'\n$(whoami)\nEOF)")

    expect(result.behavior).toBe("ask")
    expect(result.message).toContain("heredoc")
  })
})
