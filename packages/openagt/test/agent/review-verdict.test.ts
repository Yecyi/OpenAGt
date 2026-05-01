import { describe, expect, test } from "bun:test"
import { reviewVerdictFromText } from "../../src/coordinator/review-verdict"

describe("reviewVerdictFromText", () => {
  test("parses a fenced JSON verdict surrounded by prose", () => {
    const verdict = reviewVerdictFromText([
      "Reviewer summary:",
      "```json",
      JSON.stringify({
        verdict: "revise",
        required_changes: ["Add bounds check"],
        evidence_against: ["The empty input path is uncovered"],
      }),
      "```",
      "End.",
    ].join("\n"))

    expect(verdict?.verdict).toBe("revise")
    expect(verdict?.required_changes).toContain("Add bounds check")
  })

  test("does not greedily merge multiple JSON-looking objects", () => {
    const verdict = reviewVerdictFromText(
      `metadata: ${JSON.stringify({ reviewer: "critic" })}\nverdict: ${JSON.stringify({
        verdict: "pass",
        confidence: "high",
        evidence_for: ["The tests cover the changed branch"],
      })}`,
    )

    expect(verdict?.verdict).toBe("pass")
    expect(verdict?.confidence).toBe("high")
  })

  test("skips malformed candidates before a valid verdict object", () => {
    const verdict = reviewVerdictFromText(
      `scratch: {"verdict":}\n${JSON.stringify({
        verdict: "retry",
        required_changes: ["Run the review again with evidence"],
      })}`,
    )

    expect(verdict?.verdict).toBe("retry")
    expect(verdict?.required_changes).toContain("Run the review again with evidence")
  })

  test("keeps the line-oriented fallback for non-json text", () => {
    const verdict = reviewVerdictFromText("Please retry; the review missed required changes.")

    expect(verdict?.verdict).toBe("retry")
    expect(verdict?.required_changes).toContain("Reviewer requested retry")
  })

  test("does not treat negated pass wording as an approval", () => {
    const verdict = reviewVerdictFromText("This change does not pass the review; required changes remain.")

    expect(verdict?.verdict).toBe("revise")
  })
})
