// Selects and parses provider model identifiers from already-loaded model catalogs.
// It does not load providers, read auth/env state, or instantiate SDK language models.
import { mapValues, sortBy } from "remeda"
import { ModelID, ProviderID } from "./schema"

const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]

export function defaultModelIDs<T extends { models: Record<string, { id: string }> }>(
  providers: Record<string, T>,
): Record<string, string> {
  return mapValues(providers, (item) => sort(Object.values(item.models))[0].id)
}

export function sort<T extends { id: string }>(models: T[]): T[] {
  return sortBy(
    models,
    [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
    [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
    [(model) => model.id, "desc"],
  )
}

export function parseModel(model: string): { providerID: ProviderID; modelID: ModelID } {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: ProviderID.make(providerID),
    modelID: ModelID.make(rest.join("/")),
  }
}
