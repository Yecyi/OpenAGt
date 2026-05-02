import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
// Import from personal/service directly so the tool registry's load chain
// doesn't pull in personal/personal -> coordinator/coordinator (TDZ cycle).
// Service tag + Interface live in personal/service.ts; the actual layer
// construction in personal/personal.ts is provided at the AppRuntime peer
// level, not by ToolRegistry's defaultLayer.
import { Service as PersonalAgentService } from "../personal/service"
import { Instance } from "../project/instance"
import DESCRIPTION from "./escalate-to-inbox.txt"

const parameters = z.object({
  question: z.string().min(1).describe("The question or blocker the user needs to address."),
  context: z
    .string()
    .describe("1-3 sentences of relevant state. What were you trying to do and why is this blocking?"),
  priority: z.enum(["high", "normal", "low"]).default("normal").describe("Priority of the inbox item."),
  blocking: z
    .boolean()
    .default(false)
    .describe("If true, mark the inbox item state as 'blocked' so it surfaces as awaiting user response."),
  resume_with: z
    .string()
    .optional()
    .describe("Optional goal string the user can attach when resolving the item."),
})

type Metadata = {
  inbox_id: string
  blocked: boolean
}

export const EscalateToInboxTool = Tool.define<typeof parameters, Metadata, PersonalAgentService>(
  "escalate_to_inbox",
  Effect.gen(function* () {
    const personal = yield* PersonalAgentService
    return {
      description: DESCRIPTION,
      parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const payload: Record<string, unknown> = { context: params.context }
          if (params.resume_with !== undefined) payload.resume_with = params.resume_with
          const item = yield* personal.createInboxItem({
            projectID: Instance.project.id,
            sessionID: ctx.sessionID,
            source: "agent",
            scope: "session",
            goal: params.question,
            priority: params.priority,
            payload,
          })
          if (params.blocking) yield* personal.updateInboxState({ id: item.id, state: "blocked" })
          return {
            title: `Escalated: ${params.question.slice(0, 60)}`,
            output: params.blocking
              ? `Wrote inbox item ${item.id} (blocking). The user has been notified; pause work that depends on this until they resolve it.`
              : `Wrote inbox item ${item.id} (queued). The user will see this in their inbox; continue with a safe fallback if one is available.`,
            metadata: { inbox_id: item.id, blocked: params.blocking },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
