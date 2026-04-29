// Public Snapshot schemas for patch metadata and file diffs.
// This file does not run Git commands, read files, or manage snapshot lifecycle.

import z from "zod"

export const Patch = z.object({
  hash: z.string(),
  files: z.string().array(),
})
export type Patch = z.infer<typeof Patch>

export const FileDiff = z
  .object({
    file: z.string(),
    patch: z.string(),
    additions: z.number(),
    deletions: z.number(),
    status: z.enum(["added", "deleted", "modified"]).optional(),
  })
  .meta({
    ref: "SnapshotFileDiff",
  })
export type FileDiff = z.infer<typeof FileDiff>
