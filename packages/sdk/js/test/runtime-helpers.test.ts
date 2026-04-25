import { describe, expect, test } from "bun:test"
import {
  getCoordinatorProjection,
  getEffortProfile,
  getExpertLanes,
  getExpertMemoryContext,
  getQualityGates,
} from "../src/v2/runtime-helpers"

describe("runtime helpers", () => {
  test("returns coordinator projections with group data", () => {
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
    })

    expect(projection?.groups[0]?.id).toBe("research")
    expect(projection?.groups[0]?.node_ids).toEqual(["research_repo"])
    expect(getEffortProfile(projection)?.revise_policy).toBe("critical_only")
    expect(getExpertLanes(projection)?.[0]?.expert_id).toBe("coding.verifier")
    expect(getQualityGates(projection)?.[0]?.kind).toBe("final_revise")
    expect(getExpertMemoryContext(projection)?.workflow_tags).toEqual(["workflow:coding"])
  })

  test("rejects coordinator projections with malformed group data", () => {
    expect(getCoordinatorProjection({
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
    })).toBeUndefined()
  })
})
