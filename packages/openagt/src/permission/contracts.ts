// Permission request/reply schemas and typed errors.
// This file defines public contracts only; it does not evaluate rules or manage pending state.

import { ProjectID } from "@/project/schema"
import { MessageID, SessionID } from "@/session/schema"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { Schema } from "effect"
import { PermissionID } from "./schema"

export const Action = Schema.Literals(["allow", "deny", "ask"])
  .annotate({ identifier: "PermissionAction" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Action = Schema.Schema.Type<typeof Action>

export class Rule extends Schema.Class<Rule>("PermissionRule")({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
  // Wave 8 Step 3: when true, a tool invocation matching this rule should
  // be routed through a forked subagent (clean child session) rather than
  // executed in the current session. Two purposes:
  //
  //   1. Context discipline (Principle 3, Context Rot research) — risky
  //      tools that may dump large output (e.g. webfetch on a large page,
  //      bash with potentially noisy stdout) get a fresh context window
  //      so the parent session's attention budget is preserved.
  //   2. Affect isolation (Emotion-concepts paper) — failures from a
  //      risky tool don't accumulate in the parent's context as desperate-
  //      vector activation triggers; the failure stays scoped to the
  //      subagent.
  //
  // Schema-only in this commit. The harness path that consults this flag
  // (rule match -> route through TaskTool fork instead of executing inline)
  // is deferred; this field declares the policy hook for future wiring.
  requires_fresh_context: Schema.optional(Schema.Boolean),
}) {
  static readonly zod = zod(this)
}

export const Ruleset = Schema.mutable(Schema.Array(Rule))
  .annotate({ identifier: "PermissionRuleset" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Ruleset = Schema.Schema.Type<typeof Ruleset>

export class Request extends Schema.Class<Request>("PermissionRequest")({
  id: PermissionID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  tool: Schema.optional(
    Schema.Struct({
      messageID: MessageID,
      callID: Schema.String,
    }),
  ),
}) {
  static readonly zod = zod(this)
}

export const Reply = Schema.Literals(["once", "always", "reject"]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Reply = Schema.Schema.Type<typeof Reply>

const reply = {
  reply: Reply,
  message: Schema.optional(Schema.String),
}

export const ReplyBody = Schema.Struct(reply)
  .annotate({ identifier: "PermissionReplyBody" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ReplyBody = Schema.Schema.Type<typeof ReplyBody>

export class Approval extends Schema.Class<Approval>("PermissionApproval")({
  projectID: ProjectID,
  patterns: Schema.Array(Schema.String),
}) {
  static readonly zod = zod(this)
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
  }
}

export type Error = DeniedError | RejectedError | CorrectedError

export const AskInput = Schema.Struct({
  ...Request.fields,
  id: Schema.optional(PermissionID),
  ruleset: Ruleset,
})
  .annotate({ identifier: "PermissionAskInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type AskInput = Schema.Schema.Type<typeof AskInput>

export const ReplyInput = Schema.Struct({
  requestID: PermissionID,
  ...reply,
})
  .annotate({ identifier: "PermissionReplyInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ReplyInput = Schema.Schema.Type<typeof ReplyInput>
