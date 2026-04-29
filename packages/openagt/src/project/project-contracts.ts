// Defines Project schemas, events, input contracts, and row mapping.
// It does not discover git repositories, write storage, or mutate sandboxes.
import z from "zod"
import { Schema, Types } from "effect"
import { BusEvent } from "@/bus/bus-event"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { ProjectID } from "./schema"
import { ProjectTable } from "./project.sql"

export const ProjectVcs = Schema.Literal("git")

const ProjectIcon = Schema.Struct({
  url: Schema.optional(Schema.String),
  override: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
})

const ProjectCommands = Schema.Struct({
  start: Schema.optional(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
})

const ProjectTime = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
  initialized: Schema.optional(Schema.Number),
})

export const Info = Schema.Struct({
  id: ProjectID,
  worktree: Schema.String,
  vcs: Schema.optional(ProjectVcs),
  name: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIcon),
  commands: Schema.optional(ProjectCommands),
  time: ProjectTime,
  sandboxes: Schema.Array(Schema.String),
})
  .annotate({ identifier: "Project" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const Event = {
  Updated: BusEvent.define("project.updated", Info.zod),
}

type Row = typeof ProjectTable.$inferSelect

export function fromRow(row: Row): Info {
  const icon =
    row.icon_url || row.icon_color ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined } : undefined
  return {
    id: row.id,
    worktree: row.worktree,
    vcs: row.vcs ? Schema.decodeUnknownSync(ProjectVcs)(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
    commands: row.commands ?? undefined,
  }
}

export const UpdateInput = z.object({
  projectID: ProjectID.zod,
  name: z.string().optional(),
  icon: zod(ProjectIcon).optional(),
  commands: zod(ProjectCommands).optional(),
})
export type UpdateInput = z.infer<typeof UpdateInput>
