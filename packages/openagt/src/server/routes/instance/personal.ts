import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "@/project/instance"
import { PersonalAgent } from "@/personal/personal"
import {
  InboxItem,
  InboxItemID,
  InboxState,
  MemoryNote,
  MemoryScope,
  MemorySearchResult,
  ScheduledWakeup,
  ScheduledWakeupID,
  WorkPriority,
} from "@/personal/schema"
import { SessionID } from "@/session/schema"
import { errors } from "../../error"
import { jsonRequest } from "./trace"

const overview = z.object({
  inbox: z.object({
    queued: z.number().int(),
    active: z.number().int(),
    blocked: z.number().int(),
    done: z.number().int(),
    failed: z.number().int(),
    cancelled: z.number().int(),
  }),
  wakeups: z.object({
    due: z.number().int(),
    pending: z.number().int(),
    fired: z.number().int(),
  }),
  memory: z.object({
    profile: z.number().int(),
    workspace: z.number().int(),
    session: z.number().int(),
    recent: MemoryNote.array(),
  }),
})

export const PersonalRoutes = () =>
  new Hono()
    .get(
      "/overview",
      describeRoute({
        operationId: "personal.overview",
        responses: {
          200: {
            description: "Personal agent overview",
            content: {
              "application/json": {
                schema: resolver(overview),
              },
            },
          },
        },
      }),
      validator("query", z.object({ now: z.coerce.number().optional() })),
      async (c) =>
        jsonRequest("PersonalRoutes.overview", c, function* () {
          const svc = yield* PersonalAgent.Service
          return yield* svc.overview({
            projectID: Instance.project.id,
            now: c.req.valid("query").now,
          })
        }),
    )
    .get(
      "/memory",
      describeRoute({
        operationId: "personal.memory.list",
        responses: {
          200: {
            description: "Memory notes",
            content: {
              "application/json": {
                schema: resolver(MemoryNote.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          scope: MemoryScope.optional(),
          sessionID: SessionID.zod.optional(),
        }),
      ),
      async (c) =>
        jsonRequest("PersonalRoutes.memory.list", c, function* () {
          const svc = yield* PersonalAgent.Service
          const query = c.req.valid("query")
          return yield* svc.listMemory({
            scope: query.scope,
            sessionID: query.sessionID,
            projectID: Instance.project.id,
          })
        }),
    )
    .post(
      "/memory/remember",
      describeRoute({
        operationId: "personal.memory.remember",
        responses: {
          200: {
            description: "Memory note",
            content: {
              "application/json": {
                schema: resolver(MemoryNote),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          scope: MemoryScope,
          title: z.string(),
          content: z.string(),
          sessionID: SessionID.zod.optional(),
          tags: z.array(z.string()).optional(),
          source: z.enum(["manual", "coordinator", "verify", "scheduler", "gateway"]).optional(),
          importance: z.number().int().optional(),
          pinned: z.boolean().optional(),
        }),
      ),
      async (c) =>
        jsonRequest("PersonalRoutes.memory.remember", c, function* () {
          const svc = yield* PersonalAgent.Service
          const body = c.req.valid("json")
          return yield* svc.remember({
            ...body,
            source: body.source ?? "manual",
            projectID: Instance.project.id,
          })
        }),
    )
    .post(
      "/memory/search",
      describeRoute({
        operationId: "personal.memory.search",
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: resolver(MemorySearchResult.array()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          query: z.string(),
          sessionID: SessionID.zod.optional(),
          scopes: z.array(MemoryScope).optional(),
        }),
      ),
      async (c) =>
        jsonRequest("PersonalRoutes.memory.search", c, function* () {
          const svc = yield* PersonalAgent.Service
          const body = c.req.valid("json")
          return yield* svc.searchMemory({
            query: body.query,
            sessionID: body.sessionID,
            scopes: body.scopes,
            projectID: Instance.project.id,
          })
        }),
    )
    .post(
      "/memory/synthesize",
      describeRoute({
        operationId: "personal.memory.synthesize",
        responses: {
          200: {
            description: "Memory note",
            content: {
              "application/json": {
                schema: resolver(MemoryNote),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          kind: z.enum(["coordinator_run_completed", "verify_completed", "manual_preference", "follow_up_completed"]),
          sessionID: SessionID.zod.optional(),
          title: z.string(),
          content: z.string(),
          tags: z.array(z.string()).optional(),
          importance: z.number().int().optional(),
        }),
      ),
      async (c) =>
        jsonRequest("PersonalRoutes.memory.synthesize", c, function* () {
          const svc = yield* PersonalAgent.Service
          const body = c.req.valid("json")
          return yield* svc.synthesize({
            ...body,
            projectID: Instance.project.id,
          })
        }),
    )
    .get(
      "/inbox",
      describeRoute({
        operationId: "personal.inbox.list",
        responses: {
          200: {
            description: "Inbox items",
            content: {
              "application/json": {
                schema: resolver(InboxItem.array()),
              },
            },
          },
        },
      }),
      validator("query", z.object({ state: InboxState.optional() })),
      async (c) =>
        jsonRequest("PersonalRoutes.inbox.list", c, function* () {
          const svc = yield* PersonalAgent.Service
          return yield* svc.listInboxItems({
            projectID: Instance.project.id,
            state: c.req.valid("query").state,
          })
        }),
    )
    .post(
      "/inbox",
      describeRoute({
        operationId: "personal.inbox.create",
        responses: {
          200: {
            description: "Inbox item",
            content: {
              "application/json": {
                schema: resolver(InboxItem),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          source: z.enum(["session", "scheduled", "webhook"]).optional(),
          scope: MemoryScope.optional(),
          goal: z.string(),
          sessionID: SessionID.zod.optional(),
          contextRefs: z.array(z.string()).optional(),
          priority: WorkPriority.optional(),
          scheduledFor: z.number().optional(),
          payload: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
      async (c) =>
        jsonRequest("PersonalRoutes.inbox.create", c, function* () {
          const svc = yield* PersonalAgent.Service
          const body = c.req.valid("json")
          return yield* svc.createInboxItem({
            projectID: Instance.project.id,
            sessionID: body.sessionID,
            source: body.source ?? "session",
            scope: body.scope ?? "workspace",
            goal: body.goal,
            contextRefs: body.contextRefs,
            priority: body.priority,
            scheduledFor: body.scheduledFor,
            payload: body.payload,
          })
        }),
    )
    .patch(
      "/inbox/:inboxID",
      describeRoute({
        operationId: "personal.inbox.update",
        responses: {
          200: {
            description: "Inbox item",
            content: {
              "application/json": {
                schema: resolver(InboxItem),
              },
            },
          },
        },
      }),
      validator("param", z.object({ inboxID: InboxItemID.zod })),
      validator("json", z.object({ state: InboxState })),
      async (c) =>
        jsonRequest("PersonalRoutes.inbox.update", c, function* () {
          const svc = yield* PersonalAgent.Service
          return yield* svc.updateInboxState({
            id: c.req.valid("param").inboxID,
            state: c.req.valid("json").state,
          })
        }),
    )
    .get(
      "/scheduler/due",
      describeRoute({
        operationId: "personal.scheduler.due",
        responses: {
          200: {
            description: "Due wakeups",
            content: {
              "application/json": {
                schema: resolver(ScheduledWakeup.array()),
              },
            },
          },
        },
      }),
      validator("query", z.object({ now: z.coerce.number().optional() })),
      async (c) =>
        jsonRequest("PersonalRoutes.scheduler.due", c, function* () {
          const svc = yield* PersonalAgent.Service
          return yield* svc.listDueWakeups({
            projectID: Instance.project.id,
            now: c.req.valid("query").now,
          })
        }),
    )
    .post(
      "/scheduler",
      describeRoute({
        operationId: "personal.scheduler.create",
        responses: {
          200: {
            description: "Scheduled wakeup",
            content: {
              "application/json": {
                schema: resolver(ScheduledWakeup),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          goal: z.string(),
          sessionID: SessionID.zod.optional(),
          contextRefs: z.array(z.string()).optional(),
          priority: WorkPriority.optional(),
          scheduledFor: z.number(),
          payload: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
      async (c) =>
        jsonRequest("PersonalRoutes.scheduler.create", c, function* () {
          const svc = yield* PersonalAgent.Service
          const body = c.req.valid("json")
          return yield* svc.scheduleWakeup({
            projectID: Instance.project.id,
            sessionID: body.sessionID,
            goal: body.goal,
            contextRefs: body.contextRefs,
            priority: body.priority,
            scheduledFor: body.scheduledFor,
            payload: body.payload,
          })
        }),
    )
    .post(
      "/scheduler/dispatch",
      describeRoute({
        operationId: "personal.scheduler.dispatch",
        responses: {
          200: {
            description: "Dispatched inbox items",
            content: {
              "application/json": {
                schema: resolver(InboxItem.array()),
              },
            },
          },
        },
      }),
      validator("json", z.object({ now: z.number().optional() })),
      async (c) =>
        jsonRequest("PersonalRoutes.scheduler.dispatch", c, function* () {
          const svc = yield* PersonalAgent.Service
          return yield* svc.dispatchDueWakeups({
            projectID: Instance.project.id,
            now: c.req.valid("json").now,
          })
        }),
    )
    .post(
      "/scheduler/:wakeupID/complete",
      describeRoute({
        operationId: "personal.scheduler.complete",
        responses: {
          200: {
            description: "Completed wakeup",
            content: {
              "application/json": {
                schema: resolver(ScheduledWakeup),
              },
            },
          },
        },
      }),
      validator("param", z.object({ wakeupID: ScheduledWakeupID.zod })),
      async (c) =>
        jsonRequest("PersonalRoutes.scheduler.complete", c, function* () {
          const svc = yield* PersonalAgent.Service
          return yield* svc.completeWakeup(c.req.valid("param").wakeupID)
        }),
    )
    .post(
      "/gateway/webhook",
      describeRoute({
        operationId: "personal.gateway.webhook",
        responses: {
          200: {
            description: "Inbox item",
            content: {
              "application/json": {
                schema: resolver(InboxItem),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          goal: z.string(),
          scope: MemoryScope.optional(),
          contextRefs: z.array(z.string()).optional(),
          priority: WorkPriority.optional(),
          payload: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
      async (c) =>
        jsonRequest("PersonalRoutes.gateway.webhook", c, function* () {
          const svc = yield* PersonalAgent.Service
          const body = c.req.valid("json")
          return yield* svc.ingestWebhook({
            projectID: Instance.project.id,
            goal: body.goal,
            scope: body.scope,
            contextRefs: body.contextRefs,
            priority: body.priority,
            payload: body.payload,
          })
        }),
    )
