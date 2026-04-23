import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const coordinatorRunIdSchema = Schema.String.annotate({ [ZodOverride]: Identifier.schema("coordinator") }).pipe(
  Schema.brand("CoordinatorRunID"),
)

export type CoordinatorRunID = typeof coordinatorRunIdSchema.Type

export const CoordinatorRunID = coordinatorRunIdSchema.pipe(
  withStatics((schema: typeof coordinatorRunIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("coordinator", id)),
    zod: Identifier.schema("coordinator").pipe(z.custom<CoordinatorRunID>()),
  })),
)

export const NodePriority = z.enum(["high", "normal", "low"])
export type NodePriority = z.infer<typeof NodePriority>

export const TaskOrigin = z.enum(["user", "coordinator", "scheduler", "gateway"])
export type TaskOrigin = z.infer<typeof TaskOrigin>

export const CoordinatorNode = z.object({
  id: z.string(),
  description: z.string(),
  prompt: z.string(),
  task_kind: z.enum(["research", "implement", "verify", "generic"]),
  subagent_type: z.string(),
  depends_on: z.array(z.string()),
  write_scope: z.array(z.string()),
  read_scope: z.array(z.string()),
  acceptance_checks: z.array(z.string()),
  priority: NodePriority,
  origin: TaskOrigin,
})
export type CoordinatorNode = z.infer<typeof CoordinatorNode>

export const CoordinatorPlan = z.object({
  goal: z.string(),
  nodes: z.array(CoordinatorNode),
})
export type CoordinatorPlan = z.infer<typeof CoordinatorPlan>

export const CoordinatorRunState = z.enum(["planned", "active", "completed", "failed", "cancelled"])
export type CoordinatorRunState = z.infer<typeof CoordinatorRunState>

export const CoordinatorRun = z.object({
  id: CoordinatorRunID.zod,
  sessionID: z.string(),
  goal: z.string(),
  state: CoordinatorRunState,
  plan: CoordinatorPlan,
  task_ids: z.array(z.string()),
  summary: z.string().optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    finished: z.number().optional(),
  }),
})
export type CoordinatorRun = z.infer<typeof CoordinatorRun>

export * as CoordinatorSchema from "./schema"
