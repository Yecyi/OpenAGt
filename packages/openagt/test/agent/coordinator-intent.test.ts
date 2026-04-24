import { describe, expect, test } from "bun:test"
import { defaultPlanForIntent, settleIntentProfile } from "../../src/coordinator/coordinator"

describe("coordinator intent planning", () => {
  test("builds a coding workflow with executor, verifier, and reviewer roles", () => {
    const intent = settleIntentProfile({ goal: "implement mission control backend API" })
    const plan = defaultPlanForIntent(intent)

    expect(intent.task_type).toBe("coding")
    expect(intent.needs_user_clarification).toBe(false)
    expect(plan.nodes.map((item) => item.role)).toEqual(["researcher", "implementer", "verifier", "reviewer"])
    expect(plan.nodes.find((item) => item.id === "review")?.depends_on).toEqual(["verify"])
  })

  test("routes review work to read-first reviewer workflow", () => {
    const intent = settleIntentProfile({ goal: "review this pull request for regressions" })
    const plan = defaultPlanForIntent(intent)

    expect(intent.task_type).toBe("review")
    expect(plan.nodes.some((item) => item.role === "implementer")).toBe(false)
    expect(plan.nodes.some((item) => item.role === "reviewer")).toBe(true)
    expect(plan.nodes.every((item) => item.write_scope.length === 0)).toBe(true)
  })

  test("routes environment audits to auditor, verifier, and writer roles", () => {
    const intent = settleIntentProfile({ goal: "audit python powershell environment blockers" })
    const plan = defaultPlanForIntent(intent)

    expect(intent.workflow).toBe("environment-audit")
    expect(plan.nodes.map((item) => item.role)).toEqual(["environment-auditor", "verifier", "writer"])
    expect(plan.nodes.at(-1)?.output_schema).toBe("document")
  })

  test("marks high-risk automation as requiring user input", () => {
    const intent = settleIntentProfile({ goal: "automate production cleanup and delete stale credentials" })
    const plan = defaultPlanForIntent(intent)

    expect(intent.risk_level).toBe("high")
    expect(plan.nodes.find((item) => item.role === "automation-planner")?.requires_user_input).toBe(true)
  })
})
