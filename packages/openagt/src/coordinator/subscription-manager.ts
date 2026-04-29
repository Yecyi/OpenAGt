import { Bus } from "@/bus"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import { TaskRuntime } from "@/session/task-runtime"
import { Effect } from "effect"
import type { CoordinatorRunID as CoordinatorRunIDType } from "./schema"

export class CoordinatorSubscriptionManager {
  private readonly subscriptionStops = new Map<string, () => void>()

  constructor(
    private readonly bus: Bus.Interface,
    private readonly dispatchReady: (id: CoordinatorRunIDType) => Effect.Effect<unknown, Error>,
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
    const stopTaskSubscription = yield* this.bus.subscribeCallback(TaskRuntime.Event.Updated, (event) => {
      if (!event.properties.result.group_id) return
      const runID = event.properties.result.group_id as CoordinatorRunIDType
      void Effect.runPromise(
        attachWith(this.dispatchReady(runID), {
          instance,
          workspace,
        }).pipe(Effect.catchCause(() => Effect.void)),
      )
    })
    this.subscriptionStops.set(instance.directory, () => {
      stopTaskSubscription()
      this.subscriptionStops.delete(instance.directory)
    })
  })
}
