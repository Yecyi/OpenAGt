import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
// See escalate-to-inbox.ts for the rationale on importing from
// personal/service directly instead of personal/personal.
import { Service as PersonalAgentService } from "../personal/service"
import { Instance } from "../project/instance"
import DESCRIPTION from "./task-give-up.txt"

const REASONS = [
  "missing_precondition",
  "user_judgment_needed",
  "risk_threshold",
  "budget_exceeded",
  "outside_scope",
] as const

const parameters = z.object({
  reason: z.enum(REASONS).describe("Categorical reason for stopping. Pick the one that best matches the situation."),
  partial_result: z.string().optional().describe("Optional summary of what was completed before stopping."),
  recommend_next: z.string().optional().describe("Optional suggested follow-up (e.g. 'scope this PR to file X only')."),
  open_inbox_item: z
    .boolean()
    .default(true)
    .describe("If true (default), also write an inbox item recording the reason, partial result, and recommendation."),
})

type Metadata = {
  reason: (typeof REASONS)[number]
  inbox_id?: string
}

export const TaskGiveUpTool = Tool.define<typeof parameters, Metadata, PersonalAgentService>(
  "task_give_up",
  Effect.gen(function* () {
    const personal = yield* PersonalAgentService
    return {
      description: DESCRIPTION,
      parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const summary = [
            `Reason: ${params.reason}.`,
            params.partial_result ? `Partial result: ${params.partial_result}` : undefined,
            params.recommend_next ? `Recommended next: ${params.recommend_next}` : undefined,
          ]
            .filter(Boolean)
            .join(" ")

          const meta: Metadata = { reason: params.reason }

          if (params.open_inbox_item) {
            const payload: Record<string, unknown> = { reason: params.reason }
            if (params.partial_result !== undefined) payload.partial_result = params.partial_result
            if (params.recommend_next !== undefined) payload.recommend_next = params.recommend_next
            const item = yield* personal.createInboxItem({
              projectID: Instance.project.id,
              sessionID: ctx.sessionID,
              source: "agent",
              scope: "session",
              goal: `Task gave up: ${params.reason}${params.recommend_next ? ` — ${params.recommend_next}` : ""}`,
              priority: "normal",
              payload,
            })
            meta.inbox_id = item.id
          }

          return {
            title: `Gave up: ${params.reason}`,
            output: meta.inbox_id
              ? `Task ended with reason "${params.reason}". Logged to inbox ${meta.inbox_id}. ${summary} End your turn with a brief summary; do not retry the task in this turn.`
              : `Task ended with reason "${params.reason}". ${summary} End your turn with a brief summary; do not retry the task in this turn.`,
            metadata: meta,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
