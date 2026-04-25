import { describe, expect, test } from "bun:test"
import { getCoordinatorProjection } from "../src/v2/runtime-helpers"

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
    })

    expect(projection?.groups[0]?.id).toBe("research")
    expect(projection?.groups[0]?.node_ids).toEqual(["research_repo"])
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
