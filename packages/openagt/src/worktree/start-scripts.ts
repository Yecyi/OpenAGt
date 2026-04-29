import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Project } from "../project"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import { Database, eq } from "../storage"
import type { Logger } from "../util/log"

// Runs project and per-worktree startup commands after a worktree is ready.
// It does not create, remove, reset, or emit worktree lifecycle events.

export interface StartScriptsInput {
  projectID: ProjectID
  extra?: string
}

interface CreateStartScriptsInput {
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
  log: Logger
}

interface StartCommandResult {
  code: number
  stderr: string
}

export function createStartScripts(
  input: CreateStartScriptsInput,
): (directory: string, params: StartScriptsInput) => Effect.Effect<boolean> {
  function runStartCommand(directory: string, cmd: string): Effect.Effect<StartCommandResult> {
    return Effect.gen(function* () {
      const [shell, args] = process.platform === "win32" ? ["cmd", ["/c", cmd]] : ["bash", ["-lc", cmd]]
      const handle = yield* input.spawner.spawn(
        ChildProcess.make(shell, args, { cwd: directory, extendEnv: true, stdin: "ignore" }),
      )
      // Drain stdout, capture stderr for error reporting.
      const [, stderr] = yield* Effect.all(
        [Stream.runDrain(handle.stdout), Stream.mkString(Stream.decodeText(handle.stderr))],
        { concurrency: 2 },
      ).pipe(Effect.orDie)
      const code = yield* handle.exitCode
      return { code, stderr } satisfies StartCommandResult
    }).pipe(
      Effect.scoped,
      Effect.catch(() => Effect.succeed({ code: 1, stderr: "" } satisfies StartCommandResult)),
    )
  }

  function runStartScript(directory: string, cmd: string, kind: string): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      const text = cmd.trim()
      if (!text) return true
      const result = yield* runStartCommand(directory, text)
      if (result.code === 0) return true
      input.log.error("worktree start command failed", { kind, directory, message: result.stderr })
      return false
    })
  }

  return (directory: string, params: StartScriptsInput) =>
    Effect.gen(function* () {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, params.projectID)).get()),
      )
      const project = row ? Project.fromRow(row) : undefined
      const startup = project?.commands?.start?.trim() ?? ""
      const ok = yield* runStartScript(directory, startup, "project")
      if (!ok) return false
      yield* runStartScript(directory, params.extra ?? "", "worktree")
      return true
    })
}
