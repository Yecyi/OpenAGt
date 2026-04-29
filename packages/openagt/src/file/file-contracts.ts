// Defines File service schemas, events, and public contract.
// It does not read files, scan directories, or query Git/Ripgrep.
import { BusEvent } from "@/bus/bus-event"
import { Effect } from "effect"
import z from "zod"

export const Info = z
  .object({
    path: z.string(),
    added: z.number().int(),
    removed: z.number().int(),
    status: z.enum(["added", "deleted", "modified"]),
  })
  .meta({
    ref: "File",
  })
export type Info = z.infer<typeof Info>

export const Node = z
  .object({
    name: z.string(),
    path: z.string(),
    absolute: z.string(),
    type: z.enum(["file", "directory"]),
    ignored: z.boolean(),
  })
  .meta({
    ref: "FileNode",
  })
export type Node = z.infer<typeof Node>

export const Content = z
  .object({
    type: z.enum(["text", "binary"]),
    content: z.string(),
    diff: z.string().optional(),
    patch: z
      .object({
        oldFileName: z.string(),
        newFileName: z.string(),
        oldHeader: z.string().optional(),
        newHeader: z.string().optional(),
        hunks: z.array(
          z.object({
            oldStart: z.number(),
            oldLines: z.number(),
            newStart: z.number(),
            newLines: z.number(),
            lines: z.array(z.string()),
          }),
        ),
        index: z.string().optional(),
      })
      .optional(),
    encoding: z.literal("base64").optional(),
    mimeType: z.string().optional(),
  })
  .meta({
    ref: "FileContent",
  })
export type Content = z.infer<typeof Content>

export const Event = {
  Edited: BusEvent.define(
    "file.edited",
    z.object({
      file: z.string(),
    }),
  ),
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Info[]>
  readonly read: (file: string) => Effect.Effect<Content>
  readonly list: (dir?: string) => Effect.Effect<Node[]>
  readonly search: (input: {
    query: string
    limit?: number
    dirs?: boolean
    type?: "file" | "directory"
  }) => Effect.Effect<string[]>
}
