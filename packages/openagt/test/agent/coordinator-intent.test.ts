import { describe, expect, test } from "bun:test"
import { defaultPlanForIntent, settleIntentProfile } from "../../src/coordinator/coordinator"
import { isBroadAgentTask } from "../../src/agent/task-classifier"
import { continuationVelocityFor, runtimeStateFor, taskLeaseFor } from "../../src/coordinator/runtime-state"
import { buildTaskPrompt } from "../../src/coordinator/task-prompt"
import { BudgetProfile, ProgressSnapshot, TodoTimeline, type CoordinatorRun } from "../../src/coordinator/schema"
import type { TaskRuntime } from "../../src/session/task-runtime"

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

  test("populates IntentProfile.domain via the multilingual classifier (C2)", () => {
    expect(settleIntentProfile({ goal: "implement mission control backend API" }).domain).toBe("coding")
    expect(settleIntentProfile({ goal: "把发票录入财务账目并做报销" }).domain).toBe("finance")
    expect(settleIntentProfile({ goal: "总结一下这篇研究论文" }).domain).toBe("research")
    expect(settleIntentProfile({ goal: "Tell me a joke" }).domain).toBe("general")
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
    expect(plan.long_task.execution_model).toBe("epic")
    expect(plan.long_task.classification).toBe("epic")
    expect(plan.long_task.confidence).toBe("high")
    expect(plan.long_task.trigger_score).toBeGreaterThanOrEqual(10)
    expect(plan.long_task.positive_signals).toEqual(expect.arrayContaining(["broad or deep-dive goal"]))
    expect(plan.long_task.negative_signals).toEqual([])
    expect(plan.long_task.active_milestone_limit).toBe(2)
    expect(plan.long_task.milestone_count).toBeGreaterThanOrEqual(6)
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
    expect(plan.todo_timeline.milestones.map((item) => item.id)).toEqual([
      "milestone_1_plan",
      "milestone_2_research",
      "milestone_3_expert",
      "milestone_4_reduce",
      "milestone_5_verify",
      "milestone_6_final",
    ])
    expect(plan.todo_timeline.current_milestone_id).toBe("milestone_1_plan")
    expect(plan.todo_timeline.milestones.every((item) => item.expected_artifact.length > 0)).toBe(true)
    expect(Math.round(plan.todo_timeline.milestones.reduce((acc, item) => acc + item.budget_slice, 0) * 100)).toBe(100)
    expect(plan.todo_timeline.checkpoints).toEqual([])
    expect(plan.todo_timeline.evidence_ledger).toEqual([])
    expect(plan.nodes.at(-1)?.id).toBe("budget_checkpoint_synthesis")
    expect(plan.nodes.find((item) => item.id === "budget_checkpoint_synthesis")?.depends_on).toEqual(["final_revise"])
    expect(plan.budget_profile.absolute_ceiling.max_rounds).toBeGreaterThanOrEqual(240)
    expect(plan.budget_profile.absolute_ceiling.max_model_calls).toBeGreaterThanOrEqual(480)
    expect(plan.budget_profile.absolute_ceiling.max_tool_calls).toBeGreaterThanOrEqual(2400)
    expect(plan.budget_profile.absolute_ceiling.max_subagents).toBeGreaterThanOrEqual(96)
    expect(plan.budget_profile.absolute_ceiling.max_wallclock_ms).toBeGreaterThanOrEqual(8 * 60 * 60 * 1000)
    expect(plan.budget_profile.single_checkpoint_ceiling.max_wallclock_ms).toBe(45 * 60 * 1000)
    expect(plan.budget_profile.no_progress_stop.checkpoint_window).toBe(5)
    expect(plan.checkpoint_memory.current_milestone_id).toBe("milestone_1_plan")
    expect(plan.checkpoint_memory.milestone_summaries).toHaveLength(plan.todo_timeline.milestones.length)
    expect(plan.checkpoint_memory.todo_state).toHaveLength(plan.todo_timeline.todos.length)
    expect(plan.progress_snapshot.pending).toBe(plan.todo_timeline.todos.length)
  })

  test("quick scoped tasks do not trigger long-task mode just because effort is high", () => {
    const plan = defaultPlanForIntent(settleIntentProfile({ goal: "quick fix one typo" }), { effort: "high" })

    expect(plan.long_task.is_long_task).toBe(false)
    expect(plan.long_task.execution_model).toBe("short-task")
    expect(plan.long_task.classification).toBe("short")
    expect(plan.long_task.negative_signals).toEqual(expect.arrayContaining(["quick or minimal task wording"]))
    expect(plan.nodes.some((item) => item.id === "budget_checkpoint_synthesis")).toBe(false)
  })

  test("deep effort can increase scrutiny without upgrading a simple task to epic", () => {
    const plan = defaultPlanForIntent(settleIntentProfile({ goal: "summarize README" }), { effort: "deep" })

    expect(plan.long_task.execution_model).not.toBe("epic")
    expect(plan.long_task.classification).not.toBe("epic")
    expect(plan.long_task.positive_signals).toContain("deep effort selected")
    expect(plan.long_task.negative_signals).toContain("short goal with clear workflow")
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

  test("subagent prompt harness exposes role-specific contracts", () => {
    const plan = defaultPlanForIntent(settleIntentProfile({ goal: "implement mission control backend API" }))
    const taskFor = (nodeID: string, status: TaskRuntime.TaskRecord["status"] = "pending"): TaskRuntime.TaskRecord => {
      const node = plan.nodes.find((item) => item.id === nodeID)
      if (!node) throw new Error(`Missing node ${nodeID}`)
      return {
        task_id: `ses_${nodeID}` as TaskRuntime.TaskRecord["task_id"],
        group_id: "coordinator_test",
        parent_session_id: "ses_parent" as TaskRuntime.TaskRecord["parent_session_id"],
        child_session_id: `ses_child_${nodeID}` as TaskRuntime.TaskRecord["child_session_id"],
        status,
        task_kind: node.task_kind,
        subagent_type: node.subagent_type,
        description: node.description,
        prompt_hash: "hash",
        depends_on: [],
        write_scope: node.write_scope,
        read_scope: node.read_scope,
        acceptance_checks: node.acceptance_checks,
        priority: node.priority,
        origin: node.origin,
        metadata: {
          prompt: node.prompt,
          role: node.role,
          output_schema: node.output_schema,
          deterministic_checks:
            node.id === "verify_typecheck"
              ? [
                  {
                    id: "typecheck:packages/openagt",
                    source: "typecheck",
                    required: true,
                    command: "bun typecheck",
                    workdir: "packages/openagt",
                    files: ["packages/openagt/src/coordinator/foo.ts"],
                    reason: "Typecheck evidence is required.",
                  },
                ]
              : [],
          assigned_scope: node.assigned_scope,
          excluded_scope: node.excluded_scope,
          workflow: plan.workflow,
          effort: plan.effort,
          todo_timeline: plan.todo_timeline,
          long_task: plan.long_task,
        },
        created_at: Date.now(),
      }
    }

    const researcherPrompt = buildTaskPrompt(taskFor("research_repo_structure"), [])
    expect(researcherPrompt).toContain("Researcher contract")
    expect(researcherPrompt).toContain("Assigned scope")
    expect(researcherPrompt).toContain("Excluded scope")
    expect(researcherPrompt).toContain("evidence")
    expect(researcherPrompt).toContain("confidence")
    expect(researcherPrompt).toContain("unknowns")

    const reducerPrompt = buildTaskPrompt(taskFor("research_synthesis"), [
      { ...taskFor("research_repo_structure", "completed"), result_summary: "repo evidence" },
    ])
    expect(reducerPrompt).toContain("Reducer contract")
    expect(reducerPrompt).toContain("compact_synthesis")
    expect(reducerPrompt).toContain("conflicts")
    expect(reducerPrompt).toContain("recommended_next_nodes")

    const implementerPrompt = buildTaskPrompt(taskFor("implement"), [
      { ...taskFor("research_synthesis", "completed"), result_summary: "compact synthesis" },
    ])
    expect(implementerPrompt).toContain("Implementer contract")
    expect(implementerPrompt).toContain("changed_scope")
    expect(implementerPrompt).toContain("rollback_notes")
    expect(implementerPrompt).toContain("local_verification")

    const verifierPrompt = buildTaskPrompt(taskFor("verify_typecheck"), [])
    expect(verifierPrompt).toContain("Verifier contract")
    expect(verifierPrompt).toContain("assigned dimension")
    expect(verifierPrompt).toContain("Deterministic verifier checks")
    expect(verifierPrompt).toContain("bun typecheck")

    const reviewerPrompt = buildTaskPrompt(taskFor("review"), [
      { ...taskFor("verify_typecheck", "completed"), result_summary: "typecheck evidence" },
    ])
    expect(reviewerPrompt).toContain("Reviewer contract")
    expect(reviewerPrompt).toContain("verifier evidence")
    expect(reviewerPrompt).toContain("checkpoint memory")
    expect(reviewerPrompt).toContain("required_fixes")
  })

  test("task lease detects stale running subagents", () => {
    const lease = taskLeaseFor({
      task_id: "ses_task" as TaskRuntime.TaskRecord["task_id"],
      group_id: "coordinator_test",
      parent_session_id: "ses_parent" as TaskRuntime.TaskRecord["parent_session_id"],
      child_session_id: "ses_child" as TaskRuntime.TaskRecord["child_session_id"],
      status: "running",
      task_kind: "research",
      subagent_type: "general",
      description: "stale task",
      prompt_hash: "hash",
      depends_on: [],
      write_scope: [],
      read_scope: [],
      acceptance_checks: [],
      priority: "normal",
      origin: "coordinator",
      metadata: {
        effort_profile: { timeout_multiplier: 0.25 },
        lease_heartbeat_at: Date.now() - 8 * 60 * 1000,
      },
      created_at: Date.now() - 9 * 60 * 1000,
      started_at: Date.now() - 9 * 60 * 1000,
    })

    expect(lease.stale).toBe(true)
    expect(lease.threshold_ms).toBe(450_000)
  })

  test("runtime state caps long-task evidence and checkpoint lists", () => {
    const intent = settleIntentProfile({ goal: "analyze the project and produce a complete hardening plan" })
    const plan = defaultPlanForIntent(intent, { effort: "deep" })
    const nodeID = plan.nodes[0]?.id ?? "planner"
    const startedAt = Date.now()
    const tasks = Array.from({ length: 120 }, (_, index): TaskRuntime.TaskRecord => ({
      task_id: `ses_task_${index}` as TaskRuntime.TaskRecord["task_id"],
      group_id: "coordinator_test",
      parent_session_id: "ses_parent" as TaskRuntime.TaskRecord["parent_session_id"],
      child_session_id: `ses_child_${index}` as TaskRuntime.TaskRecord["child_session_id"],
      status: "completed",
      task_kind: "research",
      subagent_type: "general",
      description: `task ${index}`,
      prompt_hash: "hash",
      depends_on: [],
      write_scope: [],
      read_scope: ["packages/openagt"],
      acceptance_checks: [],
      priority: "normal",
      origin: "coordinator",
      metadata: { coordinator_node_id: nodeID },
      created_at: index,
      started_at: index,
      finished_at: index,
      result_summary: `result ${index}`,
    }))
    const runtime = runtimeStateFor(
      {
        id: "coordinator_test" as CoordinatorRun["id"],
        sessionID: "ses_parent",
        goal: "analyze the project and produce a complete hardening plan",
        intent,
        mode: "autonomous",
        workflow: intent.workflow,
        effort: "deep",
        effort_profile: plan.effort_profile,
        state: "active",
        plan,
        task_ids: tasks.map((item) => item.task_id),
        time: { created: startedAt, updated: startedAt + 120 },
      },
      tasks,
    )

    expect(runtime.todo_timeline.evidence_ledger).toHaveLength(50)
    expect(runtime.todo_timeline.checkpoints).toHaveLength(100)
    expect(runtime.todo_timeline.evidence_ledger.at(-1)?.summary).toBe("result 119")
  })

  test("continuation velocity requires progress, evidence, or verifier quality improvement", () => {
    const budgetProfile = BudgetProfile.parse({
      no_progress_stop: {
        checkpoint_window: 5,
        min_new_completed_todo_weight: 0.05,
        min_new_evidence_items: 3,
        min_quality_delta: 0.03,
      },
      continuation_state: {
        approved_count: 1,
        last_approved_progress_score: 0.5,
        last_approved_completed_todo_weight: 0.5,
        last_approved_evidence_count: 2,
        last_approved_verifier_quality: 0.4,
        last_approved_failure_penalty: 0.1,
      },
    })
    const stale = continuationVelocityFor({
      budgetProfile,
      todoTimeline: TodoTimeline.parse({
        todos: [
          { id: "done", title: "Done", status: "done", budget_weight: 1 },
          { id: "pending", title: "Pending", status: "pending", budget_weight: 1 },
        ],
        evidence_ledger: [
          { id: "e1", source_id: "t1", summary: "old evidence", created_at: 1 },
          { id: "e2", source_id: "t2", summary: "old evidence", created_at: 2 },
        ],
      }),
      progressSnapshot: ProgressSnapshot.parse({
        progress_score: 0.5,
        verifier_quality: 0.4,
        tool_success_rate: 1,
        failure_penalty: 0.1,
      }),
    })
    const improvedEvidence = continuationVelocityFor({
      budgetProfile,
      todoTimeline: TodoTimeline.parse({
        todos: [
          { id: "done", title: "Done", status: "done", budget_weight: 1 },
          { id: "pending", title: "Pending", status: "pending", budget_weight: 1 },
        ],
        evidence_ledger: Array.from({ length: 5 }, (_, index) => ({
          id: `e${index}`,
          source_id: `t${index}`,
          summary: "new evidence",
          created_at: index,
        })),
      }),
      progressSnapshot: ProgressSnapshot.parse({
        progress_score: 0.5,
        verifier_quality: 0.4,
        tool_success_rate: 1,
        failure_penalty: 0.1,
      }),
    })

    expect(stale.allowed).toBe(false)
    expect(stale.reason).toContain("no new todo completion")
    expect(improvedEvidence.allowed).toBe(true)
    expect(improvedEvidence.evidence_delta).toBe(3)
  })

  test("continuation velocity blocks obvious failure-rate regression", () => {
    const budgetProfile = BudgetProfile.parse({
      continuation_state: {
        approved_count: 1,
        last_approved_progress_score: 0.5,
        last_approved_completed_todo_weight: 0.5,
        last_approved_evidence_count: 2,
        last_approved_verifier_quality: 0.4,
        last_approved_failure_penalty: 0.1,
      },
    })
    const velocity = continuationVelocityFor({
      budgetProfile,
      todoTimeline: TodoTimeline.parse({
        todos: [
          { id: "done", title: "Done", status: "done", budget_weight: 3 },
          { id: "pending", title: "Pending", status: "pending", budget_weight: 2 },
        ],
        evidence_ledger: Array.from({ length: 6 }, (_, index) => ({
          id: `e${index}`,
          source_id: `t${index}`,
          summary: "evidence",
          created_at: index,
        })),
      }),
      progressSnapshot: ProgressSnapshot.parse({
        progress_score: 0.6,
        verifier_quality: 0.45,
        tool_success_rate: 0.4,
        failure_penalty: 0.5,
      }),
    })

    expect(velocity.allowed).toBe(false)
    expect(velocity.reason).toContain("failure rate worsened")
  })
})
