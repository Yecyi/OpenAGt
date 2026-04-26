import { describe, expect, test } from "bun:test"
import {
  getCoordinatorProjection,
  getBudgetState,
  getCheckpointMemorySummary,
  getContinuationRequest,
  getEffortProfile,
  getExpertLanes,
  getExpertMemoryContext,
  getProgressSnapshot,
  getQualityGates,
  getTodoTimeline,
} from "../src/v2/runtime-helpers"

describe("runtime helpers", () => {
  test("returns coordinator projections with group data", () => {
    const limit = {
      max_rounds: 24,
      max_model_calls: 40,
      max_tool_calls: 240,
      max_subagents: 16,
      max_wallclock_ms: 2700000,
      max_estimated_tokens: 1000000,
    }
    const projection = getCoordinatorProjection({
      run: { id: "coordinator_1" },
      tasks: [{ task_id: "ses_1" }],
      counts: {
        pending: 0,
        running: 1,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
      groups: [
        {
          id: "research",
          node_ids: ["research_repo"],
          task_ids: ["ses_1"],
          status: "running",
          merge_status: "waiting",
          blocked_by: [],
          conflicts: [],
        },
      ],
      expert_lanes: [
        {
          id: "coding:coding.verifier",
          workflow: "coding",
          role: "verifier",
          expert_id: "coding.verifier",
          node_ids: ["verify_acceptance"],
          memory_namespace: "coding:verifier",
        },
      ],
      quality_gates: [
        {
          id: "final_revise",
          kind: "final_revise",
          status: "pending",
          required: true,
        },
      ],
      revise_points: [
        {
          id: "final_revise",
          kind: "final_revise",
          status: "pending",
          required: true,
        },
      ],
      memory_context: {
        scopes: ["profile", "workspace"],
        workflow_tags: ["workflow:coding"],
        expert_tags: ["expert:coding.verifier"],
        note_ids: [],
      },
      effort_profile: {
        planning_rounds: 2,
        expert_count_min: 2,
        expert_count_max: 4,
        verifier_count_min: 1,
        reducer_enabled: true,
        reviewer_enabled: true,
        debugger_enabled: false,
        revise_policy: "critical_only",
        max_revise_nodes: 6,
        max_revision_per_artifact: 1,
        timeout_multiplier: 1.5,
      },
      long_task: {
        is_long_task: true,
        task_size: "large",
        timeline_required: true,
        reasons: ["broad goal"],
      },
      todo_timeline: {
        required: true,
        todos: [
          {
            id: "todo_research",
            title: "Gather evidence",
            status: "active",
            priority: "high",
            budget_weight: 2,
            acceptance_hint: "Evidence collected",
            depends_on: [],
            assigned_stage: "research",
            node_ids: ["research_repo"],
            expert_lane_ids: ["coding:coding.verifier"],
          },
        ],
        phases: [
          {
            id: "phase_research",
            title: "Research",
            todo_ids: ["todo_research"],
            expected_outputs: ["Evidence collected"],
            checkpoint_after: true,
          },
        ],
      },
      budget_profile: {
        scale: "normal",
        auto_continue: "safe",
        mission_ceiling: limit,
        phase_ceiling: limit,
        todo_budget: { todo_research: limit },
        checkpoint_reserve: limit,
        absolute_ceiling: limit,
        single_checkpoint_ceiling: limit,
        no_progress_stop: {
          checkpoint_window: 5,
          min_new_completed_todo_weight: 0.05,
          min_new_evidence_items: 3,
          min_quality_delta: 0.03,
        },
      },
      budget_state: {
        soft_budget_used: 0.25,
        absolute_ceiling_used: 0.1,
        checkpoint_count: 1,
        budget_limited: false,
        ceiling_hit: false,
      },
      progress_snapshot: {
        done: 0,
        partial: 1,
        blocked: 0,
        pending: 0,
        progress_score: 0.4,
        evidence_coverage: 0.5,
        verifier_quality: 0.8,
        tool_success_rate: 1,
        remaining_work_score: 0.6,
        failure_penalty: 0,
        confidence: "medium",
      },
      checkpoint_memory: {
        run_id: "coordinator_1",
        checkpoint_id: "checkpoint_1",
        todo_state: [],
        completed_artifacts: [],
        evidence_index: ["Evidence collected"],
        unresolved_claims: [],
        blocked_reasons: [],
        quality_scores: { progress_score: 0.4 },
        next_recommended_todos: ["todo_research"],
        compressed_context: "Research is in progress.",
      },
      continuation_request: {
        reason: "Mission budget checkpoint reached with unfinished timeline items.",
        requested_budget_delta: limit,
        next_todos: ["todo_research"],
        expected_value: "Continue targeted work.",
        requires_user_approval: true,
      },
    })

    expect(projection?.groups[0]?.id).toBe("research")
    expect(projection?.groups[0]?.node_ids).toEqual(["research_repo"])
    expect(getEffortProfile(projection)?.revise_policy).toBe("critical_only")
    expect(getExpertLanes(projection)?.[0]?.expert_id).toBe("coding.verifier")
    expect(getQualityGates(projection)?.[0]?.kind).toBe("final_revise")
    expect(getExpertMemoryContext(projection)?.workflow_tags).toEqual(["workflow:coding"])
    expect(getTodoTimeline(projection)?.todos[0]?.id).toBe("todo_research")
    expect(getBudgetState(projection)?.checkpoint_count).toBe(1)
    expect(getProgressSnapshot(projection)?.evidence_coverage).toBe(0.5)
    expect(getContinuationRequest(projection)?.next_todos).toEqual(["todo_research"])
    expect(getCheckpointMemorySummary(projection)?.evidence_index).toEqual(["Evidence collected"])
  })

  test("rejects coordinator projections with malformed group data", () => {
    expect(
      getCoordinatorProjection({
        run: { id: "coordinator_1" },
        tasks: [],
        counts: {
          pending: 0,
          running: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
        },
        groups: [
          {
            id: "research",
            node_ids: "research_repo",
            task_ids: [],
            status: "pending",
            merge_status: "waiting",
          },
        ],
      }),
    ).toBeUndefined()
  })
})
