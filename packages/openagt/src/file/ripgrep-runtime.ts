// Runtime helpers for the ripgrep service.
// This file handles process environment, abort/error conversion, and queue failure only.

import { Cause, Effect, Queue } from "effect"
import type { PlatformError } from "effect/PlatformError"

import { sanitizedProcessEnv } from "@/util/opencode-process"

export function env() {
  const env = sanitizedProcessEnv()
  delete env.RIPGREP_CONFIG_PATH
  return env
}

function aborted(signal?: AbortSignal) {
  const err = signal?.reason
  if (err instanceof Error) return err
  const out = new Error("Aborted")
  out.name = "AbortError"
  return out
}

function waitForAbort(signal?: AbortSignal) {
  if (!signal) return Effect.never
  if (signal.aborted) return Effect.fail(aborted(signal))
  return Effect.callback<never, Error>((resume) => {
    const onabort = () => resume(Effect.fail(aborted(signal)))
    signal.addEventListener("abort", onabort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", onabort))
  })
}

export function error(stderr: string, code: number): Error {
  const err = new Error(stderr.trim() || `ripgrep failed with code ${code}`)
  err.name = "RipgrepError"
  return err
}

export function fail(queue: Queue.Queue<string, PlatformError | Error | Cause.Done>, err: PlatformError | Error): void {
  Queue.failCauseUnsafe(queue, Cause.fail(err))
}

export function raceAbort<A, E, R>(effect: Effect.Effect<A, E, R>, signal?: AbortSignal) {
  return signal ? effect.pipe(Effect.raceFirst(waitForAbort(signal))) : effect
}
