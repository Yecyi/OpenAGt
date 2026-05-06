import { describe, expect, test } from "bun:test"
import { buildDiagnosticFeedback } from "../../src/lsp/feedback"

const diagnostic = (severity: 1 | 2 | 3 | 4, message = "diagnostic") => ({
  severity,
  message,
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  },
})

describe("LSP diagnostic feedback", () => {
  test("summarizes before and after diagnostics for an edited file", () => {
    const feedback = buildDiagnosticFeedback({
      file: "/repo/src/app.ts",
      normalizedFile: "/repo/src/app.ts",
      before: {
        "/repo/src/app.ts": [diagnostic(1, "old error"), diagnostic(2, "old warning")],
      },
      after: {
        "/repo/src/app.ts": [diagnostic(2, "remaining warning")],
        "/repo/src/other.ts": [diagnostic(1, "workspace error")],
      },
    })

    expect(feedback.status).toBe("has_warnings")
    expect(feedback.trend).toBe("improved")
    expect(feedback.before.errors).toBe(1)
    expect(feedback.after.errors).toBe(0)
    expect(feedback.fixed_errors).toBe(1)
    expect(feedback.workspace.errors).toBe(1)
    expect(feedback.report).toBe("")
  })

  test("reports new file errors as regression", () => {
    const feedback = buildDiagnosticFeedback({
      file: "/repo/src/app.ts",
      normalizedFile: "/repo/src/app.ts",
      before: {},
      after: {
        "/repo/src/app.ts": [diagnostic(1, "new error")],
      },
    })

    expect(feedback.status).toBe("has_errors")
    expect(feedback.trend).toBe("regressed")
    expect(feedback.new_errors).toBe(1)
    expect(feedback.report).toContain("<diagnostics")
    expect(feedback.report).toContain("new error")
  })
})
