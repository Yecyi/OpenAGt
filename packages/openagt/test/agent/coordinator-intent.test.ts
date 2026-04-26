import { describe, expect, test } from "bun:test"
import { defaultPlanForIntent, settleIntentProfile } from "../../src/coordinator/coordinator"

describe("coordinator intent planning", () => {
  test("builds a coding workflow with parallel research, reducer, verifier group, and reviewer", () => {
    const intent = settleIntentProfile({ goal: "implement mission control backend API" })
    const plan = defaultPlanForIntent(intent)

    expect(intent.task_type).toBe("coding")
    expect(intent.needs_user_clarification).toBe(false)
    expect(plan.nodes.filter((item) => item.parallel_group === "research").map((item) => item.role)).toEqual([
      "researcher",
      "researcher",
      "researcher",
      "researcher",
    ])
    expect(plan.nodes.find((item) => item.id === "research_synthesis")?.role).toBe("reducer")
    expect(plan.nodes.find((item) => item.id === "implement")?.depends_on).toEqual(["research_synthesis"])
    expect(plan.nodes.filter((item) => item.parallel_group === "verify").map((item) => item.id)).toEqual([
      "verify_typecheck",
      "verify_focused_tests",
      "verify_acceptance",
    ])
    expect(plan.nodes.find((item) => item.id === "review")?.depends_on).toEqual([
      "verify_typecheck",
      "verify_focused_tests",
      "verify_acceptance",
    ])
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

  test("high effort enables multi-round planning, multi-expert lanes, reducer, reviewer, and critical revise", () => {
    const intent = settleIntentProfile({ goal: "implement mission control backend API" })
    const plan = defaultPlanForIntent(intent, { effort: "high" })

    expect(plan.effort).toBe("high")
    expect(plan.effort_profile.planning_rounds).toBe(2)
    expect(plan.effort_profile.revise_policy).toBe("critical_only")
    expect(plan.nodes.filter((item) => item.role === "planner")).toHaveLength(2)
    expect(plan.nodes.some((item) => item.role === "reducer")).toBe(true)
    expect(plan.nodes.some((item) => item.role === "reviewer")).toBe(true)
    expect(plan.expert_lanes.length).toBeGreaterThanOrEqual(2)
    expect(plan.revise_points.map((item) => item.kind)).toEqual(expect.arrayContaining([
      "plan_revise",
      "reducer_revise",
      "verifier_revise",
      "final_revise",
    ]))
    expect(plan.revise_points).toHaveLength(plan.quality_gates.length)
  })

  test("deep effort adds full artifact revise gates without write scope", () => {
    const intent = settleIntentProfile({ goal: "research OpenAGt coordinator architecture" })
    const plan = defaultPlanForIntent(intent, { effort: "deep" })

    expect(plan.effort).toBe("deep")
    expect(plan.effort_profile.revise_policy).toBe("all_artifacts")
    expect(plan.nodes.filter((item) => item.role === "planner")).toHaveLength(3)
    expect(plan.revise_points.map((item) => item.kind)).toEqual(expect.arrayContaining([
      "plan_revise",
      "input_revise",
      "output_revise",
      "handoff_revise",
      "final_revise",
    ]))
    expect(plan.nodes.filter((item) => item.role === "reviser").every((item) => item.write_scope.length === 0)).toBe(true)
    expect(plan.revise_points.length).toBeLessThanOrEqual(plan.effort_profile.max_revise_nodes)
  })

  test("routes broad project deep dives to sharded research experts", () => {
    const intent = settleIntentProfile({ goal: "dive deeper into this project and give me a outline of key technological details, algorithems" })
    const plan = defaultPlanForIntent(intent)
    const research = plan.nodes.filter((item) => item.parallel_group === "research")

    expect(intent.workflow).toBe("research")
    expect(intent.workflow_confidence).toBe("high")
    expect(research.map((item) => item.id)).toEqual([
      "research_architecture",
      "research_agent_runtime",
      "research_data_safety",
      "research_tests_release",
    ])
    expect(research.every((item) => item.subagent_type === "explore")).toBe(true)
    expect(research.every((item) => item.write_scope.length === 0)).toBe(true)
    expect(plan.nodes.find((item) => item.id === "research_synthesis")?.depends_on).toEqual([
      "research_architecture",
      "research_agent_runtime",
      "research_data_safety",
      "research_tests_release",
    ])
    expect(plan.nodes.find((item) => item.id === "research_synthesis")?.prompt).toContain("technical architecture outline")
    expect(plan.nodes.find((item) => item.id === "synthesize")?.depends_on).toEqual(["research_synthesis"])
  })

  test("routes non-coding workflows to specialized expert adapters", () => {
    const writing = defaultPlanForIntent(settleIntentProfile({ goal: "write a product announcement article" }))
    const data = defaultPlanForIntent(settleIntentProfile({ goal: "analyze dataset statistics and anomalies" }))
    const planning = defaultPlanForIntent(settleIntentProfile({ goal: "plan a v1.16 roadmap with milestones" }))
    const admin = defaultPlanForIntent(settleIntentProfile({ goal: "prioritize inbox follow-up calendar tasks" }))

    expect(writing.workflow).toBe("writing")
    expect(writing.nodes.map((item) => item.role)).toEqual(["planner", "writer", "style-editor"])
    expect(data.workflow).toBe("data-analysis")
    expect(data.nodes.map((item) => item.id)).toEqual(["profile_data", "analyze_data", "verify_stats"])
    expect(planning.workflow).toBe("planning")
    expect(planning.nodes.map((item) => item.role)).toEqual(["planner", "constraint-checker", "risk-reviewer"])
    expect(admin.workflow).toBe("personal-admin")
    expect(admin.nodes.map((item) => item.role)).toEqual(["inbox-classifier", "scheduler", "privacy-reviewer"])
  })
})
