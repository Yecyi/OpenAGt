export * as ConfigExpert from "./expert"

import { Schema } from "effect"
import z from "zod"
import { Bus } from "@/bus"
import { zod } from "@/util/effect-zod"
import { Log } from "../util"
import { NamedError } from "@openagt/shared/util/error"
import { Glob } from "@openagt/shared/util/glob"
import { configEntryNameFromPath } from "./entry-name"
import { InvalidError } from "./error"
import * as ConfigMarkdown from "./markdown"

const log = Log.create({ service: "config-expert" })

// Expert role definition. Mirrors ConfigAgent's frontmatter+body pattern but
// describes a coordinator-side expert (a role within the task graph) rather
// than a session-side agent.
//
// Conservative DXR: every user-defined expert MUST `inherits` from one of
// the 38 builtin CoordinatorNodeRole values. Effort governance and quality
// gates dispatch off the parent role; the user prompt template just substitutes
// for that role's hardcoded prompt.
const ExpertSchema = Schema.StructWithRest(
  Schema.Struct({
    role: Schema.String,
    inherits: Schema.String.annotate({
      description: "Parent role name. Must be one of the 38 builtin CoordinatorNodeRole values.",
    }),
    domain: Schema.optional(Schema.String).annotate({
      description: "Domain tag, e.g. 'tax-law', 'molecular-biology'.",
    }),
    description: Schema.String,
    workflows: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "If set, expert is only used when the active workflow is in this list.",
    }),
    output_schema: Schema.optional(Schema.String).annotate({
      description: "Override the parent role's output_schema. Must be in CoordinatorOutputSchema.",
    }),
    prompt_template_id: Schema.optional(Schema.String).annotate({
      description: "Reference into the PromptTemplates registry, e.g. 'reviser/tax-law'.",
    }),
    default_priority: Schema.optional(Schema.Literals(["high", "normal", "low"])),
    default_risk: Schema.optional(Schema.Literals(["low", "medium", "high"])),
    acceptance_checks: Schema.optional(Schema.Array(Schema.String)),
    memory_namespace: Schema.optional(Schema.String).annotate({
      description: "Override default ${workflow}:${role} memory namespace.",
    }),
    mpacr_perspective: Schema.optional(
      Schema.Literals(["factuality", "coherence", "risk", "domain_expertise", "user_value"]),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
)

export const Info = zod(ExpertSchema).meta({ ref: "ExpertConfig" }) as unknown as z.ZodType<{
  role: string
  inherits: string
  domain?: string
  description: string
  workflows?: readonly string[]
  output_schema?: string
  prompt_template_id?: string
  default_priority?: "high" | "normal" | "low"
  default_risk?: "low" | "medium" | "high"
  acceptance_checks?: readonly string[]
  memory_namespace?: string
  mpacr_perspective?: "factuality" | "coherence" | "risk" | "domain_expertise" | "user_value"
  prompt?: string
}>
export type Info = z.infer<typeof Info>

export async function load(dir: string) {
  const result: Record<string, Info> = {}
  for (const item of await Glob.scan("{expert,experts}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse expert ${item}`
      const { Session } = await import("@/session")
      void Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load expert", { expert: item, err })
      return undefined
    })
    if (!md) continue

    const patterns = ["/.opencode/expert/", "/.opencode/experts/", "/expert/", "/experts/"]
    const role = configEntryNameFromPath(item, patterns)

    const config = {
      role,
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Info.safeParse(config)
    if (parsed.success) {
      result[config.role] = parsed.data
      continue
    }
    throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
  }
  return result
}
