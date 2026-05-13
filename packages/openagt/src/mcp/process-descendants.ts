import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type * as PlatformError from "effect/PlatformError"
import type * as Scope from "effect/Scope"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"

type McpProcessSpawner = {
  spawn: (command: ChildProcess.Command) => Effect.Effect<ChildProcessHandle, PlatformError.PlatformError, Scope.Scope>
}

export const mcpProcessDescendants = Effect.fnUntraced(
  function* (spawner: McpProcessSpawner, pid: number) {
    if (process.platform === "win32") return [] as number[]
    const pids: number[] = []
    const queue = [pid]
    while (queue.length > 0) {
      const current = queue.shift()!
      const handle = yield* spawner.spawn(ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }))
      const text = yield* Stream.mkString(Stream.decodeText(handle.stdout))
      yield* handle.exitCode
      for (const tok of text.split("\n")) {
        const cpid = parseInt(tok, 10)
        if (!isNaN(cpid) && !pids.includes(cpid)) {
          pids.push(cpid)
          queue.push(cpid)
        }
      }
    }
    return pids
  },
  Effect.scoped,
  Effect.catch(() => Effect.succeed([] as number[])),
)
