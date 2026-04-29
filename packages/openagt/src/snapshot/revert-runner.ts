// Reverts snapshot patch file lists back to recorded Git tree entries.
// It does not track snapshots, compute diffs, or own service locking.
import path from "path"
import { Effect } from "effect"
import { core } from "./git-constants"
import type { Patch } from "./schema"
import type { SnapshotGitOptions, SnapshotGitResult, SnapshotGitState } from "./git-runner"

type SnapshotRevertLog = {
  info(message: string, data?: Record<string, unknown>): void
}

export class SnapshotReverter {
  constructor(
    private readonly deps: {
      args: (cmd: string[]) => string[]
      git: (cmd: string[], opts?: SnapshotGitOptions) => Effect.Effect<SnapshotGitResult>
      log: SnapshotRevertLog
      remove: (file: string) => Effect.Effect<void>
      state: SnapshotGitState
    },
  ) {}

  revert(patches: Patch[]): Effect.Effect<void> {
    const deps = this.deps
    return Effect.gen(function* () {
      const ops: { hash: string; file: string; rel: string }[] = []
      const seen = new Set<string>()
      for (const item of patches) {
        for (const file of item.files) {
          if (seen.has(file)) continue
          seen.add(file)
          ops.push({
            hash: item.hash,
            file,
            rel: path.relative(deps.state.worktree, file).replaceAll("\\", "/"),
          })
        }
      }

      const single = Effect.fnUntraced(function* (op: (typeof ops)[number]) {
        deps.log.info("reverting", { file: op.file, hash: op.hash })
        const result = yield* deps.git([...core, ...deps.args(["checkout", op.hash, "--", op.file])], {
          cwd: deps.state.worktree,
        })
        if (result.code === 0) return
        const tree = yield* deps.git([...core, ...deps.args(["ls-tree", op.hash, "--", op.rel])], {
          cwd: deps.state.worktree,
        })
        if (tree.code === 0 && tree.text.trim()) {
          deps.log.info("file existed in snapshot but checkout failed, keeping", { file: op.file, hash: op.hash })
          return
        }
        deps.log.info("file did not exist in snapshot, deleting", { file: op.file, hash: op.hash })
        yield* deps.remove(op.file)
      })

      const clash = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)

      for (let i = 0; i < ops.length; ) {
        const first = ops[i]!
        const run = [first]
        let j = i + 1
        // Only batch adjacent files when their paths cannot affect each other.
        while (j < ops.length && run.length < 100) {
          const next = ops[j]!
          if (next.hash !== first.hash) break
          if (run.some((item) => clash(item.rel, next.rel))) break
          run.push(next)
          j += 1
        }

        if (run.length === 1) {
          yield* single(first)
          i = j
          continue
        }

        const tree = yield* deps.git(
          [...core, ...deps.args(["ls-tree", "--name-only", first.hash, "--", ...run.map((item) => item.rel)])],
          {
            cwd: deps.state.worktree,
          },
        )

        if (tree.code !== 0) {
          deps.log.info("batched ls-tree failed, falling back to single-file revert", {
            hash: first.hash,
            files: run.length,
          })
          for (const op of run) {
            yield* single(op)
          }
          i = j
          continue
        }

        const have = new Set(
          tree.text
            .trim()
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
        )
        const list = run.filter((item) => have.has(item.rel))
        if (list.length) {
          deps.log.info("reverting", { hash: first.hash, files: list.length })
          const result = yield* deps.git(
            [...core, ...deps.args(["checkout", first.hash, "--", ...list.map((item) => item.file)])],
            {
              cwd: deps.state.worktree,
            },
          )
          if (result.code !== 0) {
            deps.log.info("batched checkout failed, falling back to single-file revert", {
              hash: first.hash,
              files: list.length,
            })
            for (const op of run) {
              yield* single(op)
            }
            i = j
            continue
          }
        }

        for (const op of run) {
          if (have.has(op.rel)) continue
          deps.log.info("file did not exist in snapshot, deleting", { file: op.file, hash: op.hash })
          yield* deps.remove(op.file)
        }

        i = j
      }
    })
  }
}
