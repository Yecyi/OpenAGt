import { Bus } from "@/bus"
import * as EffectLogger from "@/effect/logger"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import { TaskRuntime } from "@/session/task-runtime"
import { Cause, Effect } from "effect"
import type { CoordinatorRunID as CoordinatorRunIDType } from "./schema"

export class CoordinatorSubscriptionManager {
  private readonly subscriptionStops = new Map<string, () => void>()

  constructor(
    private readonly bus: Bus.Interface,
    private readonly dispatchReady: (id: CoordinatorRunIDType) => Effect.Effect<unknown, Error>,
    private readonly markDispatchFailure: (id: CoordinatorRunIDType, reason: string) => Effect.Effect<unknown, Error>,
  ) {}

  clear(): void {
    for (const stop of this.subscriptionStops.values()) stop()
    this.subscriptionStops.clear()
  }

  ensureSubscribed: () => Effect.Effect<void, Error> = Effect.fn("Coordinator.ensureSubscribed")(function* (
    this: CoordinatorSubscriptionManager,
  ) {
    const instance = yield* InstanceState.context
    if (this.subscriptionStops.has(instance.directory)) return
    const workspace = yield* InstanceState.workspaceID
    const log = EffectLogger.create({ service: "coordinator" })
    const markDispatchFailure = this.markDispatchFailure
    const dispatchAfterTaskUpdate = (runID: CoordinatorRunIDType, attempt = 1): Effect.Effect<void> =>
      attachWith(this.dispatchReady(runID), {
        instance,
        workspace,
      }).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (Cause.hasInterruptsOnly(cause)) return
            const pretty = Cause.pretty(cause)
            if (pretty.includes("cannot dispatch from state:") || pretty.includes("Coordinator run not found:")) return
            yield* log.error("coordinator dispatch after task update failed", {
              runID,
              workspace,
              directory: instance.directory,
              attempt,
              cause: pretty,
            })
            if (attempt < 3) {
              yield* Effect.sleep(`${attempt * 100} millis`)
              yield* dispatchAfterTaskUpdate(runID, attempt + 1)
              return
            }
            yield* attachWith(markDispatchFailure(runID, pretty), { instance, workspace }).pipe(
              Effect.catchCause(() => Effect.void),
            )
          }),
        ),
      )
    const stopTaskSubscription = yield* this.bus.subscribeCallback(TaskRuntime.Event.Updated, (event) => {
      if (!event.properties.result.group_id) return
      const runID = event.properties.result.group_id as CoordinatorRunIDType
      void Effect.runPromise(dispatchAfterTaskUpdate(runID))
    })
    this.subscriptionStops.set(instance.directory, () => {
      stopTaskSubscription()
      this.subscriptionStops.delete(instance.directory)
    })
  })
}
