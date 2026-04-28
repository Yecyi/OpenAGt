import z from "zod"

// Defines the public Worktree data contracts.
// It does not create, remove, reset, or inspect worktrees.

export const Info = z
  .object({
    name: z.string(),
    branch: z.string(),
    directory: z.string(),
  })
  .meta({
    ref: "Worktree",
  })

export type Info = z.infer<typeof Info>

export const CreateInput = z
  .object({
    name: z.string().optional(),
    startCommand: z.string().optional().describe("Additional startup script to run after the project's start command"),
  })
  .meta({
    ref: "WorktreeCreateInput",
  })

export type CreateInput = z.infer<typeof CreateInput>

export const RemoveInput = z
  .object({
    directory: z.string(),
  })
  .meta({
    ref: "WorktreeRemoveInput",
  })

export type RemoveInput = z.infer<typeof RemoveInput>

export const ResetInput = z
  .object({
    directory: z.string(),
  })
  .meta({
    ref: "WorktreeResetInput",
  })

export type ResetInput = z.infer<typeof ResetInput>
