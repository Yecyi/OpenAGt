import z from "zod"
import { NamedError } from "@openagt/shared/util/error"

// Defines Worktree-specific error classes.
// It does not perform Git, filesystem, or lifecycle operations.

export const NotGitError = NamedError.create(
  "WorktreeNotGitError",
  z.object({
    message: z.string(),
  }),
)

export const NameGenerationFailedError = NamedError.create(
  "WorktreeNameGenerationFailedError",
  z.object({
    message: z.string(),
  }),
)

export const CreateFailedError = NamedError.create(
  "WorktreeCreateFailedError",
  z.object({
    message: z.string(),
  }),
)

export const StartCommandFailedError = NamedError.create(
  "WorktreeStartCommandFailedError",
  z.object({
    message: z.string(),
  }),
)

export const RemoveFailedError = NamedError.create(
  "WorktreeRemoveFailedError",
  z.object({
    message: z.string(),
  }),
)

export const ResetFailedError = NamedError.create(
  "WorktreeResetFailedError",
  z.object({
    message: z.string(),
  }),
)
