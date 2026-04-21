/**
 * Model Selection Module
 *
 * Extracted from session/prompt.ts
 * Handles model retrieval and selection logic
 */

import { Effect } from "effect"
import { Provider } from "@/provider"
import { Session } from "@/session"
import { ModelID, ProviderID } from "@/provider/schema"
import { Log } from "@/util"

const log = Log.create({ service: "model-selection" })

/**
 * Get model by provider and model ID with error handling
 */
export async function getModel(providerID: string, modelID: string): Promise<Provider.Model> {
  return Effect.runPromise(
    Provider.Service.getModel(ProviderID.make(providerID), ModelID.make(modelID)).pipe(
      Effect.mapError((e) => new Error(`Failed to get model ${providerID}/${modelID}: ${e}`)),
    ),
  )
}

/**
 * Get the last used model for a session
 */
export async function getLastModel(sessionID: string): Promise<Provider.Model | undefined> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const session = yield* Session.Service
      const info = yield* session.info(SessionID.make(sessionID))
      if (!info?.model) return undefined

      const model = yield* Provider.Service.getModel(
        ProviderID.make(info.model.providerID),
        ModelID.make(info.model.id),
      ).pipe(Effect.option)

      if (model._tag === "None") {
        log.warn("last model not found", { provider: info.model.providerID, model: info.model.id })
        return undefined
      }

      return model.value
    }),
  )
}
