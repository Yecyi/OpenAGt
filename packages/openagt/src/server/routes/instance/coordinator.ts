import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Coordinator } from "@/coordinator/coordinator"
import {
  CoordinatorMode,
  CoordinatorNode,
  CoordinatorPlan,
  CoordinatorRun,
  CoordinatorRunID,
  EffortLevel,
  EffortProfile,
  IntentProfile,
  MemoryContext,
  ParallelExecutionPolicy,
  QualityGate,
  RevisePoint,
  ExpertLane,
  TaskType,
  AutoContinuePolicy,
  BudgetProfile,
  BudgetScale,
  BudgetState,
  CheckpointMemorySummary,
  ContinuationRequest,
  LongTaskProfile,
  ProgressSnapshot,
  ResourceLimit,
  TodoTimeline,
} from "@/coordinator/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { SessionID } from "@/session/schema"
import { errors } from "../../error"
import { jsonRequest } from "./trace"

const runPayload = z.object({
  goal: z.string(),
  nodes: z.array(CoordinatorNode).optional(),
  intent: IntentProfile.optional(),
  effort: EffortLevel.optional(),
  workflow: TaskType.optional(),
  mode: CoordinatorMode.optional(),
  approved: z.boolean().optional(),
  parallel_policy: ParallelExecutionPolicy.partial().optional(),
  budget: BudgetScale.optional(),
  autoContinue: AutoContinuePolicy.optional(),
  maxRounds: z.number().int().min(1).optional(),
  maxSubagents: z.number().int().min(1).optional(),
  maxWallclockMs: z.number().int().min(60_000).optional(),
})

const intentPayload = z.object({
  goal: z.string(),
})

const retryPayload = z
  .object({
    task_id: SessionID.zod.optional(),
    node_id: z.string().optional(),
  })
  .optional()

const continuePayload = z
  .object({
    budget_delta: ResourceLimit.partial().optional(),
    autoContinue: AutoContinuePolicy.optional(),
  })
  .optional()

const projection = z.object({
  run: CoordinatorRun,
  tasks: z.array(TaskRuntime.TaskRecord),
  counts: z.object({
    pending: z.number().int(),
    running: z.number().int(),
    completed: z.number().int(),
    partial: z.number().int(),
    failed: z.number().int(),
    cancelled: z.number().int(),
  }),
  groups: z.array(
    z.object({
      id: z.string(),
      node_ids: z.array(z.string()),
      task_ids: z.array(z.string()),
      status: z.enum(["pending", "running", "completed", "partial", "failed", "cancelled"]),
      merge_status: z.enum(["none", "waiting", "merged", "conflict"]),
      blocked_by: z.array(z.string()),
      conflicts: z.array(z.string()),
      started_at: z.number().optional(),
      completed_at: z.number().optional(),
    }),
  ),
  expert_lanes: z.array(ExpertLane),
  quality_gates: z.array(QualityGate),
  revise_points: z.array(RevisePoint),
  memory_context: MemoryContext,
  effort_profile: EffortProfile,
  long_task: LongTaskProfile,
  todo_timeline: TodoTimeline,
  budget_profile: BudgetProfile,
  budget_state: BudgetState,
  progress_snapshot: ProgressSnapshot,
  checkpoint_memory: CheckpointMemorySummary,
  continuation_request: ContinuationRequest.optional(),
  budget_limited: z.boolean(),
  specialization_fallback: z.boolean(),
})

export const CoordinatorRoutes = () =>
  new Hono()
    .post(
      "/intent/settle",
      describeRoute({
        operationId: "coordinator.intent.settle",
        responses: {
          200: {
            description: "Settled coordinator intent",
            content: {
              "application/json": {
                schema: resolver(IntentProfile),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", intentPayload),
      async (c) =>
        jsonRequest("CoordinatorRoutes.intent.settle", c, function* () {
          const svc = yield* Coordinator.Service
          return yield* svc.settleIntent(c.req.valid("json"))
        }),
    )
    .post(
      "/plan/generate",
      describeRoute({
        operationId: "coordinator.plan.generate",
        responses: {
          200: {
            description: "Generated coordinator plan",
            content: {
              "application/json": {
                schema: resolver(CoordinatorPlan),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", runPayload),
      async (c) =>
        jsonRequest("CoordinatorRoutes.plan.generate", c, function* () {
          const svc = yield* Coordinator.Service
          return yield* svc.plan(c.req.valid("json"))
        }),
    )
    .post(
      "/plan",
      describeRoute({
        operationId: "coordinator.plan",
        responses: {
          200: {
            description: "Coordinator plan",
            content: {
              "application/json": {
                schema: resolver(CoordinatorPlan),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", runPayload),
      async (c) =>
        jsonRequest("CoordinatorRoutes.plan", c, function* () {
          const svc = yield* Coordinator.Service
          return yield* svc.plan(c.req.valid("json"))
        }),
    )
    .post(
      "/run/:sessionID",
      describeRoute({
        operationId: "coordinator.run",
        responses: {
          200: {
            description: "Coordinator run",
            content: {
              "application/json": {
                schema: resolver(CoordinatorRun),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", runPayload),
      async (c) =>
        jsonRequest("CoordinatorRoutes.run", c, function* () {
          const svc = yield* Coordinator.Service
          const body = c.req.valid("json")
          return yield* svc.run({
            sessionID: c.req.valid("param").sessionID,
            goal: body.goal,
            nodes: body.nodes,
            intent: body.intent,
            effort: body.effort,
            workflow: body.workflow,
            mode: body.mode,
            approved: body.approved,
            parallel_policy: body.parallel_policy,
            budget: body.budget,
            autoContinue: body.autoContinue,
            maxRounds: body.maxRounds,
            maxSubagents: body.maxSubagents,
            maxWallclockMs: body.maxWallclockMs,
          })
        }),
    )
    .get(
      "/run/:runID",
      describeRoute({
        operationId: "coordinator.get",
        responses: {
          200: {
            description: "Coordinator run",
            content: {
              "application/json": {
                schema: resolver(CoordinatorRun.nullable()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ runID: CoordinatorRunID.zod })),
      async (c) =>
        jsonRequest("CoordinatorRoutes.get", c, function* () {
          const svc = yield* Coordinator.Service
          const result = yield* svc.get(c.req.valid("param").runID)
          return result._tag === "Some" ? result.value : null
        }),
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        operationId: "coordinator.list",
        responses: {
          200: {
            description: "Coordinator runs",
            content: {
              "application/json": {
                schema: resolver(CoordinatorRun.array()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) =>
        jsonRequest("CoordinatorRoutes.list", c, function* () {
          const svc = yield* Coordinator.Service
          return yield* svc.list(c.req.valid("param").sessionID)
        }),
    )
    .post(
      "/run/:runID/approve",
      describeRoute({
        operationId: "coordinator.approve",
        responses: {
          200: {
            description: "Approved coordinator run",
            content: {
              "application/json": {
                schema: resolver(CoordinatorRun),
              },
            },
          },
        },
      }),
      validator("param", z.object({ runID: CoordinatorRunID.zod })),
      async (c) =>
        jsonRequest("CoordinatorRoutes.approve", c, function* () {
          const svc = yield* Coordinator.Service
          return yield* svc.approve(c.req.valid("param").runID)
        }),
    )
    .post(
      "/run/:runID/cancel",
      describeRoute({
        operationId: "coordinator.cancel",
        responses: {
          200: {
            description: "Cancelled coordinator run",
            content: {
              "application/json": {
                schema: resolver(CoordinatorRun),
              },
            },
          },
        },
      }),
      validator("param", z.object({ runID: CoordinatorRunID.zod })),
      async (c) =>
        jsonRequest("CoordinatorRoutes.cancel", c, function* () {
          const svc = yield* Coordinator.Service
          return yield* svc.cancel(c.req.valid("param").runID)
        }),
    )
    .post(
      "/run/:runID/retry",
      describeRoute({
        operationId: "coordinator.retry",
        responses: {
          200: {
            description: "Retried coordinator run",
            content: {
              "application/json": {
                schema: resolver(CoordinatorRun),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ runID: CoordinatorRunID.zod })),
      validator("json", retryPayload),
      async (c) =>
        jsonRequest("CoordinatorRoutes.retry", c, function* () {
          const svc = yield* Coordinator.Service
          const body = c.req.valid("json")
          return yield* svc.retry({
            id: c.req.valid("param").runID,
            taskID: body?.task_id,
            nodeID: body?.node_id,
          })
        }),
    )
    .post(
      "/run/:runID/continue",
      describeRoute({
        operationId: "coordinator.continue",
        responses: {
          200: {
            description: "Continued coordinator run with approved budget",
            content: {
              "application/json": {
                schema: resolver(CoordinatorRun),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ runID: CoordinatorRunID.zod })),
      validator("json", continuePayload),
      async (c) =>
        jsonRequest("CoordinatorRoutes.continue", c, function* () {
          const svc = yield* Coordinator.Service
          const body = c.req.valid("json")
          return yield* svc.continueRun({
            id: c.req.valid("param").runID,
            budgetDelta: body?.budget_delta,
            autoContinue: body?.autoContinue,
          })
        }),
    )
    .post(
      "/run/:runID/summarize",
      describeRoute({
        operationId: "coordinator.summarize",
        responses: {
          200: {
            description: "Coordinator summary",
            content: {
              "application/json": {
                schema: resolver(z.object({ summary: z.string() })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ runID: CoordinatorRunID.zod })),
      async (c) =>
        jsonRequest("CoordinatorRoutes.summarize", c, function* () {
          const svc = yield* Coordinator.Service
          return { summary: yield* svc.summarize(c.req.valid("param").runID) }
        }),
    )
    .post(
      "/run/:runID/dispatch",
      describeRoute({
        operationId: "coordinator.dispatch",
        responses: {
          200: {
            description: "Coordinator dispatch result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    run: CoordinatorRun,
                    dispatched: z.number().int(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator("param", z.object({ runID: CoordinatorRunID.zod })),
      async (c) =>
        jsonRequest("CoordinatorRoutes.dispatch", c, function* () {
          const svc = yield* Coordinator.Service
          return yield* svc.dispatch(c.req.valid("param").runID)
        }),
    )
    .get(
      "/run/:runID/projection",
      describeRoute({
        operationId: "coordinator.projection",
        responses: {
          200: {
            description: "Coordinator projection",
            content: {
              "application/json": {
                schema: resolver(projection),
              },
            },
          },
        },
      }),
      validator("param", z.object({ runID: CoordinatorRunID.zod })),
      async (c) =>
        jsonRequest("CoordinatorRoutes.projection", c, function* () {
          const svc = yield* Coordinator.Service
          return yield* svc.projection(c.req.valid("param").runID)
        }),
    )
    .post(
      "/run/:runID/resume",
      describeRoute({
        operationId: "coordinator.resume",
        responses: {
          200: {
            description: "Coordinator run",
            content: {
              "application/json": {
                schema: resolver(CoordinatorRun),
              },
            },
          },
        },
      }),
      validator("param", z.object({ runID: CoordinatorRunID.zod })),
      async (c) =>
        jsonRequest("CoordinatorRoutes.resume", c, function* () {
          const svc = yield* Coordinator.Service
          return yield* svc.resume(c.req.valid("param").runID)
        }),
    )
