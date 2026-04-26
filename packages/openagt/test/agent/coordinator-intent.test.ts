import { describe, expect, test } from "bun:test"
import { defaultPlanForIntent, settleIntentProfile } from "../../src/coordinator/coordinator"
import { isBroadAgentTask } from "../../src/agent/task-classifier"

describe("coordinator intent planning", () => {
  test("broad task classifier requires project or depth context for architecture and algorithms", () => {
    expect(isBroadAgentTask("explain the quicksort algorithm")).toBe(false)
    expect(isBroadAgentTask("draft an architecture decision record")).toBe(false)
    expect(isBroadAgentTask("dive deeper into this project and outline architecture and algorithms")).toBe(true)
    expect(isBroadAgentTask("深入分析这个项目的架构和算法")).toBe(true)
  })

  test("classifies Chinese high-risk debugging without falling back to general operations", () => {
    const intent = settleIntentProfile({ goal: "调试生产数据库丢失问题" })

    expect(intent.workflow).toBe("debugging")
    expect(intent.risk_level).toBe("high")
    expect(intent.workflow_confidence).toBe("high")
  })

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
    expect(plan.nodes.filter((item) => item.role !== "reviser").map((item) => item.role)).toEqual([
      "environment-auditor",
      "verifier",
      "writer",
    ])
    expect(plan.nodes.find((item) => item.id === "report")?.output_schema).toBe("document")
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
    expect(plan.revise_points.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["plan_revise", "reducer_revise", "verifier_revise", "final_revise"]),
    )
    expect(plan.revise_points).toHaveLength(plan.quality_gates.length)
  })

  test("deep effort adds full artifact revise gates without write scope", () => {
    const intent = settleIntentProfile({ goal: "research OpenAGt coordinator architecture" })
    const plan = defaultPlanForIntent(intent, { effort: "deep" })

    expect(plan.effort).toBe("deep")
    expect(plan.effort_profile.revise_policy).toBe("all_artifacts")
    expect(plan.nodes.filter((item) => item.role === "planner")).toHaveLength(3)
    expect(plan.revise_points.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["plan_revise", "input_revise", "output_revise", "handoff_revise", "final_revise"]),
    )
    expect(plan.nodes.filter((item) => item.role === "reviser").every((item) => item.write_scope.length === 0)).toBe(
      true,
    )
    expect(plan.revise_points.length).toBeLessThanOrEqual(plan.effort_profile.max_revise_nodes)
  })

  test("routes broad project deep dives to sharded research experts", () => {
    const intent = settleIntentProfile({
      goal: "dive deeper into this project and give me a outline of key technological details, algorithems",
    })
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
    expect(plan.nodes.find((item) => item.id === "research_synthesis")?.prompt).toContain(
      "technical architecture outline",
    )
    expect(plan.nodes.find((item) => item.id === "synthesize")?.depends_on).toEqual(["research_synthesis"])
  })

  test("deep broad analysis creates long-task timeline, adaptive budget, and checkpoint synthesis", () => {
    const intent = settleIntentProfile({
      goal: "dive deeper into this project and give me a comprehensive outline of key technological details, algorithms, architecture, full project structure and release risks",
    })
    const plan = defaultPlanForIntent(intent, { effort: "deep" })

    expect(plan.long_task.is_long_task).toBe(true)
    expect(plan.long_task.task_size).toBe("huge")
    expect(plan.long_task.timeline_required).toBe(true)
    expect(plan.todo_timeline.required).toBe(true)
    expect(plan.todo_timeline.todos.map((item) => item.id)).toEqual([
      "todo_plan",
      "todo_research",
      "todo_expert",
      "todo_reduce",
      "todo_verify",
      "todo_final",
    ])
    expect(plan.todo_timeline.todos.every((item) => item.node_ids.length > 0)).toBe(true)
    expect(plan.nodes.at(-1)?.id).toBe("budget_checkpoint_synthesis")
    expect(plan.nodes.find((item) => item.id === "budget_checkpoint_synthesis")?.depends_on).toEqual(["final_revise"])
    expect(plan.budget_profile.absolute_ceiling.max_rounds).toBeGreaterThanOrEqual(240)
    expect(plan.budget_profile.absolute_ceiling.max_model_calls).toBeGreaterThanOrEqual(480)
    expect(plan.budget_profile.absolute_ceiling.max_tool_calls).toBeGreaterThanOrEqual(2400)
    expect(plan.budget_profile.absolute_ceiling.max_subagents).toBeGreaterThanOrEqual(96)
    expect(plan.budget_profile.absolute_ceiling.max_wallclock_ms).toBeGreaterThanOrEqual(8 * 60 * 60 * 1000)
    expect(plan.budget_profile.single_checkpoint_ceiling.max_wallclock_ms).toBe(45 * 60 * 1000)
    expect(plan.budget_profile.no_progress_stop.checkpoint_window).toBe(5)
    expect(plan.checkpoint_memory.todo_state).toHaveLength(plan.todo_timeline.todos.length)
    expect(plan.progress_snapshot.pending).toBe(plan.todo_timeline.todos.length)
  })

  test("small medium tasks keep timeline optional but still review final output", () => {
    const plan = defaultPlanForIntent(settleIntentProfile({ goal: "summarize README" }), { effort: "medium" })

    expect(plan.long_task.is_long_task).toBe(false)
    expect(plan.todo_timeline.required).toBe(false)
    expect(plan.nodes.some((item) => item.id === "budget_checkpoint_synthesis")).toBe(false)
    expect(plan.revise_points.some((item) => item.kind === "final_revise")).toBe(true)
  })

  test("routes non-coding workflows to specialized expert adapters", () => {
    const writing = defaultPlanForIntent(settleIntentProfile({ goal: "write a product announcement article" }))
    const data = defaultPlanForIntent(settleIntentProfile({ goal: "analyze dataset statistics and anomalies" }))
    const planning = defaultPlanForIntent(settleIntentProfile({ goal: "plan a v1.16 roadmap with milestones" }))
    const admin = defaultPlanForIntent(settleIntentProfile({ goal: "prioritize inbox follow-up calendar tasks" }))

    expect(writing.workflow).toBe("writing")
    expect(writing.nodes.filter((item) => item.role !== "reviser").map((item) => item.role)).toEqual([
      "planner",
      "writer",
      "style-editor",
    ])
    expect(data.workflow).toBe("data-analysis")
    expect(data.nodes.filter((item) => item.role !== "reviser").map((item) => item.id)).toEqual([
      "profile_data",
      "analyze_data",
      "verify_stats",
    ])
    expect(planning.workflow).toBe("planning")
    expect(planning.nodes.filter((item) => item.role !== "reviser").map((item) => item.role)).toEqual([
      "planner",
      "constraint-checker",
      "risk-reviewer",
    ])
    expect(admin.workflow).toBe("personal-admin")
    expect(admin.nodes.filter((item) => item.role !== "reviser").map((item) => item.role)).toEqual([
      "inbox-classifier",
      "scheduler",
      "privacy-reviewer",
    ])
    expect([writing, data, planning, admin].every((plan) => plan.nodes.some((item) => item.role === "reviser"))).toBe(
      true,
    )
  })

  test("all public workflow adapters produce concrete non-empty plans", () => {
    const cases = [
      ["coding", "implement a backend API"],
      ["review", "review this pull request"],
      ["debugging", "debug failing tests"],
      ["research", "research this project architecture"],
      ["writing", "write a technical article"],
      ["data-analysis", "analyze dataset statistics"],
      ["planning", "plan a release roadmap"],
      ["personal-admin", "prioritize inbox follow-up tasks"],
      ["documentation", "update README documentation"],
      ["environment-audit", "audit powershell python environment"],
      ["automation", "automate scheduled cleanup workflow"],
      ["file-data-organization", "organize files into folders"],
      ["general-operations", "complete this general task"],
    ] as const

    for (const [workflow, goal] of cases) {
      const plan = defaultPlanForIntent(settleIntentProfile({ goal }), { workflow })
      expect(plan.workflow).toBe(workflow)
      expect(plan.nodes.length).toBeGreaterThan(0)
      expect(plan.nodes.some((item) => item.role !== "reviser")).toBe(true)
    }
  })
})
