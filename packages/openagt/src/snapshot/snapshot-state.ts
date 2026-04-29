// Builds snapshot state from the active project instance.
// It does not run git commands, inspect files, or manage snapshot locks.
import path from "path"
import { Hash } from "@openagt/shared/util/hash"
import { Global } from "@/global"
import type { InstanceContext } from "@/project/instance"
import type { SnapshotGitState } from "./git-runner"

export interface SnapshotState extends SnapshotGitState {
  readonly vcs?: "git"
}

export function buildSnapshotState(ctx: InstanceContext): SnapshotState {
  return {
    directory: ctx.directory,
    worktree: ctx.worktree,
    gitdir: path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree)),
    vcs: ctx.project.vcs,
  }
}
