import type { Model, Provider } from "@openagt/sdk/v2"

export function indexProviders(list: Provider[] | undefined): ReadonlyMap<string, Provider> {
  return new Map((list ?? []).map((item) => [item.id, item] as const))
}

export function findProviderModel(
  list: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
): Model | undefined {
  const provider =
    list instanceof Map
      ? list.get(providerID)
      : Array.isArray(list)
        ? list.find((item) => item.id === providerID)
        : undefined
  return provider?.models[modelID]
}

export function getProviderModelName(
  list: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
): string {
  return findProviderModel(list, providerID, modelID)?.name ?? modelID
}
