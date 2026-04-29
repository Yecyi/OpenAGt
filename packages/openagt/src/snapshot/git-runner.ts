// Owns low-level Git process execution for snapshots.
// It does not decide snapshot lifecycle, file selection, or diff formatting.
import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { cfg } from "./git-constants"

export interface SnapshotGitState {
  readonly directory: string
  readonly worktree: string
  readonly gitdir: string
}

export interface SnapshotGitResult {
  readonly code: ChildProcessSpawner.ExitCode
  readonly text: string
  readonly stderr: string
}

export interface SnapshotGitOptions {
  readonly cwd?: string
  readonly env?: Record<string, string>
  readonly stdin?: ChildProcess.CommandInput
}

export interface SnapshotGitBatchRef {
  readonly ref: string
}

export interface SnapshotGitBatchResult {
  readonly code: ChildProcessSpawner.ExitCode
  readonly out: Uint8Array
  readonly stderr: string
}

export class SnapshotGitRunner {
  constructor(
    private readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
    private readonly state: SnapshotGitState,
  ) {}

  args(cmd: string[]): string[] {
    return ["--git-dir", this.state.gitdir, "--work-tree", this.state.worktree, ...cmd]
  }

  feed(list: string[]): ChildProcess.CommandInput {
    return Stream.make(new TextEncoder().encode(list.join("\0") + "\0"))
  }

  git(cmd: string[], opts?: SnapshotGitOptions): Effect.Effect<SnapshotGitResult> {
    const spawner = this.spawner
    return Effect.gen(function* () {
      const proc = ChildProcess.make("git", cmd, {
        cwd: opts?.cwd,
        env: opts?.env,
        extendEnv: true,
        stdin: opts?.stdin,
      })
      const handle = yield* spawner.spawn(proc)
      const [text, stderr] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
        { concurrency: 2 },
      )
      const code = yield* handle.exitCode
      return { code, text, stderr }
    }).pipe(
      Effect.scoped,
      Effect.catch((err) =>
        Effect.succeed({
          code: ChildProcessSpawner.ExitCode(1),
          text: "",
          stderr: err instanceof Error ? err.message : String(err),
        }),
      ),
    )
  }

  catFileBatch(refs: SnapshotGitBatchRef[]): Effect.Effect<SnapshotGitBatchResult, unknown> {
    const spawner = this.spawner
    const state = this.state
    const args = this.args(["cat-file", "--batch"])
    return Effect.gen(function* () {
      const proc = ChildProcess.make("git", [...cfg, ...args], {
        cwd: state.directory,
        extendEnv: true,
        stdin: Stream.make(new TextEncoder().encode(refs.map((item) => item.ref).join("\n") + "\n")),
      })
      const handle = yield* spawner.spawn(proc)
      const [out, stderr] = yield* Effect.all(
        [Stream.mkUint8Array(handle.stdout), Stream.mkString(Stream.decodeText(handle.stderr))],
        { concurrency: 2 },
      )
      const code = yield* handle.exitCode
      return { code, out, stderr }
    }).pipe(Effect.scoped)
  }
}
