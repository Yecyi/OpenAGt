import { test, expect } from "bun:test"
import { dispatchSelectionFor } from "../../src/coordinator/dispatch-selection"
import { CoordinatorPlan, type CoordinatorRun } from "../../src/coordinator/schema"
import { defaultResourceLimit } from "../../src/coordinator/schema-budget"
import type { TaskRuntime } from "../../src/session/task-runtime"

// Build a minimal CoordinatorRun whose only meaningful field for these tests is
// the parallel_policy and node list. Other fields use schema defaults.
function makeRun(overrides: {
  nodes: Array<{
    id: string
    parallel_group?: string
    write_scope: string[]
  }>
  write_parallel_requires_disjoint_scope: boolean
  max_parallel_agents?: number
}): CoordinatorRun {
  const plan = CoordinatorPlan.parse({
    goal: "test",
    nodes: overrides.nodes.map((node) => ({
      id: node.id,
      description: "",
      prompt: "",
      task_kind: "implement",
      subagent_type: "worker",
      depends_on: [],
      write_scope: node.write_scope,
      read_scope: [],
      acceptance_checks: [],
      priority: "normal",
      origin: "coordinator",
      parallel_group: node.parallel_group,
    })),
    parallel_policy: {
      mode: "safe",
      max_parallel_agents: overrides.max_parallel_agents ?? 4,
      max_parallel_tools: 8,
      read_only_parallel_allowed: true,
      write_parallel_requires_disjoint_scope: overrides.write_parallel_requires_disjoint_scope,
      merge_strategy: "research-synthesis",
      conflict_resolution_strategy: "targeted-research",
    },
  })
  return {
    id: "coordinator_test",
    sessionID: "ses_test",
    goal: "test",
    intent: {
      goal: "test",
      task_type: "general-operations",
      success_criteria: [],
      risk_level: "medium",
      needs_user_clarification: false,
      clarification_questions: [],
      workflow: "general-operations",
      workflow_confidence: "medium",
      secondary_workflows: [],
      expected_output: "",
      permission_expectations: [],
    },
    mode: "auto",
    workflow: "general-operations",
    effort: "medium",
    effort_profile: plan.effort_profile,
    state: "active",
    plan,
    task_ids: [],
    time: { created: 0, updated: 0 },
  } as unknown as CoordinatorRun
}

function makeTask(input: {
  id: string
  status: TaskRuntime.TaskRecord["status"]
  nodeId: string
  parallel_group?: string
  write_scope?: string[]
}): TaskRuntime.TaskRecord {
  return {
    task_id: input.id,
    parent_session_id: "ses_test",
    status: input.status,
    task_kind: "implement",
    subagent_type: "worker",
    description: "",
    prompt_hash: "",
    depends_on: [],
    write_scope: input.write_scope ?? [],
    read_scope: [],
    acceptance_checks: [],
    priority: "normal",
    origin: "coordinator",
    metadata: {
      coordinator_node_id: input.nodeId,
      ...(input.parallel_group ? { parallel_group: input.parallel_group } : {}),
    },
    created_at: 0,
    usage: undefined,
  } as unknown as TaskRuntime.TaskRecord
}

const zeroUsage = {
  max_rounds: 0,
  max_model_calls: 0,
  max_tool_calls: 0,
  max_subagents: 0,
  max_wallclock_ms: 0,
  max_estimated_tokens: 0,
}

test("disjoint write_scope across same parallel_group: both selected", () => {
  const run = makeRun({
    nodes: [
      { id: "n1", parallel_group: "g1", write_scope: ["src/a"] },
      { id: "n2", parallel_group: "g1", write_scope: ["src/b"] },
    ],
    write_parallel_requires_disjoint_scope: true,
  })
  const t1 = makeTask({ id: "t1", status: "pending", nodeId: "n1", parallel_group: "g1", write_scope: ["src/a"] })
  const t2 = makeTask({ id: "t2", status: "pending", nodeId: "n2", parallel_group: "g1", write_scope: ["src/b"] })
  const result = dispatchSelectionFor({
    run,
    allTasks: [t1, t2],
    ready: [t1, t2],
    usage: zeroUsage,
    normalAbsoluteLimit: defaultResourceLimit,
    checkpointSlots: 100,
    ceilingHit: false,
    softBudgetHit: false,
  })
  expect(result.selected.map((item) => String(item.task_id))).toEqual(["t1", "t2"])
})

test("overlapping write_scope in same round: only first selected (regression: EBI #8)", () => {
  const run = makeRun({
    nodes: [
      { id: "n1", parallel_group: "g1", write_scope: ["src/shared"] },
      { id: "n2", parallel_group: "g1", write_scope: ["src/shared/foo"] },
    ],
    write_parallel_requires_disjoint_scope: true,
  })
  const t1 = makeTask({ id: "t1", status: "pending", nodeId: "n1", parallel_group: "g1", write_scope: ["src/shared"] })
  const t2 = makeTask({
    id: "t2",
    status: "pending",
    nodeId: "n2",
    parallel_group: "g1",
    write_scope: ["src/shared/foo"],
  })
  const result = dispatchSelectionFor({
    run,
    allTasks: [t1, t2],
    ready: [t1, t2],
    usage: zeroUsage,
    normalAbsoluteLimit: defaultResourceLimit,
    checkpointSlots: 100,
    ceilingHit: false,
    softBudgetHit: false,
  })
  // t2 is filtered because its scope (src/shared/foo) overlaps with t1's (src/shared)
  expect(result.selected.map((item) => String(item.task_id))).toEqual(["t1"])
})

test("overlap with running task is blocked", () => {
  const run = makeRun({
    nodes: [
      { id: "n1", parallel_group: "g1", write_scope: ["src/x"] },
      { id: "n2", parallel_group: "g1", write_scope: ["src/x/sub"] },
    ],
    write_parallel_requires_disjoint_scope: true,
  })
  const running = makeTask({
    id: "trunning",
    status: "running",
    nodeId: "n1",
    parallel_group: "g1",
    write_scope: ["src/x"],
  })
  const candidate = makeTask({
    id: "tcandidate",
    status: "pending",
    nodeId: "n2",
    parallel_group: "g1",
    write_scope: ["src/x/sub"],
  })
  const result = dispatchSelectionFor({
    run,
    allTasks: [running, candidate],
    ready: [candidate],
    usage: zeroUsage,
    normalAbsoluteLimit: defaultResourceLimit,
    checkpointSlots: 100,
    ceilingHit: false,
    softBudgetHit: false,
  })
  expect(result.selected.map((item) => String(item.task_id))).toEqual([])
})

test("read-only candidate (empty write_scope) is never blocked by disjoint check", () => {
  const run = makeRun({
    nodes: [
      { id: "n1", parallel_group: "g1", write_scope: ["src/y"] },
      { id: "n2", parallel_group: "g1", write_scope: [] },
    ],
    write_parallel_requires_disjoint_scope: true,
  })
  const t1 = makeTask({ id: "t1", status: "pending", nodeId: "n1", parallel_group: "g1", write_scope: ["src/y"] })
  const tReadOnly = makeTask({ id: "tro", status: "pending", nodeId: "n2", parallel_group: "g1", write_scope: [] })
  const result = dispatchSelectionFor({
    run,
    allTasks: [t1, tReadOnly],
    ready: [t1, tReadOnly],
    usage: zeroUsage,
    normalAbsoluteLimit: defaultResourceLimit,
    checkpointSlots: 100,
    ceilingHit: false,
    softBudgetHit: false,
  })
  expect(result.selected.map((item) => String(item.task_id))).toEqual(["t1", "tro"])
})

test("policy disabled: overlapping writes are dispatched anyway", () => {
  const run = makeRun({
    nodes: [
      { id: "n1", parallel_group: "g1", write_scope: ["src/a"] },
      { id: "n2", parallel_group: "g1", write_scope: ["src/a"] },
    ],
    write_parallel_requires_disjoint_scope: false,
  })
  const t1 = makeTask({ id: "t1", status: "pending", nodeId: "n1", parallel_group: "g1", write_scope: ["src/a"] })
  const t2 = makeTask({ id: "t2", status: "pending", nodeId: "n2", parallel_group: "g1", write_scope: ["src/a"] })
  const result = dispatchSelectionFor({
    run,
    allTasks: [t1, t2],
    ready: [t1, t2],
    usage: zeroUsage,
    normalAbsoluteLimit: defaultResourceLimit,
    checkpointSlots: 100,
    ceilingHit: false,
    softBudgetHit: false,
  })
  expect(result.selected.map((item) => String(item.task_id))).toEqual(["t1", "t2"])
})
