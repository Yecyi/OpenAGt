// Defines workspace schemas, events, and row mapping.
// It does not create adaptors, sync SSE, or mutate workspace storage.
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { WorkspaceID } from "./schema"
import { WorkspaceInfo } from "./types"
import { WorkspaceTable } from "./workspace.sql"

export const Info = WorkspaceInfo.meta({
  ref: "Workspace",
})
export type Info = z.infer<typeof Info>

export const ConnectionStatus = z.object({
  workspaceID: WorkspaceID.zod,
  status: z.enum(["connected", "connecting", "disconnected", "error"]),
})
export type ConnectionStatus = z.infer<typeof ConnectionStatus>

const Restore = z.object({
  workspaceID: WorkspaceID.zod,
  sessionID: SessionID.zod,
  total: z.number().int().min(0),
  step: z.number().int().min(0),
})

export const Event = {
  Ready: BusEvent.define(
    "workspace.ready",
    z.object({
      name: z.string(),
    }),
  ),
  Failed: BusEvent.define(
    "workspace.failed",
    z.object({
      message: z.string(),
    }),
  ),
  Restore: BusEvent.define("workspace.restore", Restore),
  Status: BusEvent.define("workspace.status", ConnectionStatus),
}

export function fromRow(row: typeof WorkspaceTable.$inferSelect): Info {
  return {
    id: row.id,
    type: row.type,
    branch: row.branch,
    name: row.name,
    directory: row.directory,
    extra: row.extra,
    projectID: row.project_id,
  }
}

export const CreateInput = z.object({
  id: WorkspaceID.zod.optional(),
  type: Info.shape.type,
  branch: Info.shape.branch,
  projectID: ProjectID.zod,
  extra: Info.shape.extra,
})

export const SessionRestoreInput = z.object({
  workspaceID: WorkspaceID.zod,
  sessionID: SessionID.zod,
})
