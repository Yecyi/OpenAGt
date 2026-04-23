export * as ConfigExecPolicy from "./exec-policy"

import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const Decision = Schema.Literals(["allow", "confirm", "block"])
  .annotate({ identifier: "ExecPolicyDecisionConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Decision = Schema.Schema.Type<typeof Decision>

export const PatternToken = Schema.Union([
  Schema.String,
  Schema.mutable(Schema.Array(Schema.String)),
])
  .annotate({ identifier: "ExecPolicyPatternTokenConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type PatternToken = Schema.Schema.Type<typeof PatternToken>

export const Rule = Schema.Struct({
  pattern: Schema.mutable(Schema.Array(PatternToken)).annotate({
    description: "Ordered command prefix tokens. Array entries denote alternatives.",
  }),
  decision: Schema.optional(Decision).annotate({
    description: "Policy decision for matching commands. Defaults to allow.",
  }),
  justification: Schema.optional(Schema.String).annotate({
    description: "Human-readable rationale or safer alternative.",
  }),
})
  .annotate({ identifier: "ExecPolicyRuleConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Rule = Schema.Schema.Type<typeof Rule>

export const Info = Schema.Struct({
  rules: Schema.mutable(Schema.Array(Rule)).annotate({
    description: "Prefix-based shell execution policy rules.",
  }),
})
  .annotate({ identifier: "ExecPolicyConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>
