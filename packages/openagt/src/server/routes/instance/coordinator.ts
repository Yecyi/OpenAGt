import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Coordinator } from "@/coordinator/coordinator"
import { CoordinatorNode, CoordinatorPlan, CoordinatorRun, CoordinatorRunID } from "@/coordinator/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { SessionID } from "@/session/schema"
import { errors } from "../../error"
import { jsonRequest } from "./trace"

const runPayload = z.object({
  goal: z.string(),
  nodes: z.array(CoordinatorNode).optional(),
})

const projection = z.object({
  run: CoordinatorRun,
  tasks: z.array(TaskRuntime.TaskRecord),
  counts: z.object({
    pending: z.number().int(),
    running: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
    cancelled: z.number().int(),
  }),
})

export const CoordinatorRoutes = () =>
  new Hono()
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
