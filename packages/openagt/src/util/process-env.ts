import { Effect } from "effect"

export function withProcessEnv<A, E, R>(values: Record<string, string | undefined>, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = new Map<string, string | undefined>()
      for (const [key, value] of Object.entries(values)) {
        previous.set(key, process.env[key])
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return () => {
        for (const [key, value] of previous) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
    }),
    () => effect,
    (restore) => Effect.sync(restore),
  )
}
