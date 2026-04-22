/**
 * Model Selection Module
 *
 * Extracted from session/prompt.ts
 * Handles model retrieval and selection logic
 */

import { Effect } from "effect"
import { Provider } from "@/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Log } from "@/util"

const log = Log.create({ service: "model-selection" })

/**
 * Get model by provider and model ID (async wrapper).
 */
export async function getModel(providerID: string, modelID: string): Promise<Provider.Model> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
    }).pipe(Effect.provide(Provider.defaultLayer)),
  )
}

/**
 * Get the last used model for a session.
 * Returns undefined since Session.Info does not track per-session model in this context.
 */
export async function getLastModel(_sessionID: string): Promise<Provider.Model | undefined> {
  log.warn("getLastModel not implemented - session model tracking not available")
  return undefined
}
