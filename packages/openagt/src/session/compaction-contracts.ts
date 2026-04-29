// Defines SessionCompaction events, constants, and service contract.
// It does not prune messages, call models, or publish compaction events.
import { BusEvent } from "@/bus/bus-event"
import { Effect } from "effect"
import z from "zod"
import { Provider } from "@/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageV2 } from "./message-v2"
import { MessageID, SessionID } from "./schema"

export const Event = {
  Compacted: BusEvent.define(
    "session.compacted",
    z.object({
      sessionID: SessionID.zod,
    }),
  ),
}

export const COMPACTION_CIRCUIT_FAILURES = 3
export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
export const PRUNE_PROTECTED_TOOLS = ["skill"]

export interface Interface {
  readonly isOverflow: (input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: {
    parentID: MessageID
    messages: MessageV2.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderID; modelID: ModelID }
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<void>
}
