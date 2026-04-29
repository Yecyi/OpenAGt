import { BusEvent } from "@/bus/bus-event"
import { InboxItem, MemoryNote, ScheduledWakeup } from "./schema"

export const MemoryUpdated = BusEvent.define("memory.updated", MemoryNote)
export const InboxCreated = BusEvent.define("inbox.created", InboxItem)
export const InboxUpdated = BusEvent.define("inbox.updated", InboxItem)
export const SchedulerScheduled = BusEvent.define("scheduler.scheduled", ScheduledWakeup)
export const SchedulerFired = BusEvent.define(
  "scheduler.fired",
  ScheduledWakeup.extend({
    inbox_item: InboxItem,
  }),
)
export const SchedulerCompleted = BusEvent.define("scheduler.completed", ScheduledWakeup)
