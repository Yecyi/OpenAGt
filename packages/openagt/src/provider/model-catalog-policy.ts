// Applies final model catalog filters and variant overrides to an already-loaded provider.
// It does not read config/env/auth, load SDKs, or change provider discovery order.
import { mapValues, mergeDeep, omit, pickBy } from "remeda"
import { ProviderID } from "./schema"
import type { Info } from "./provider"
import * as ProviderTransform from "./transform"

type ConfigModel = {
  variants?: Record<string, Record<string, unknown> & { disabled?: boolean }>
}

type ConfigProvider = {
  blacklist?: string[]
  whitelist?: string[]
  models?: Record<string, ConfigModel>
}

export function applyModelCatalogPolicy(input: {
  providerID: ProviderID
  provider: Info
  configProvider?: ConfigProvider
  experimentalModels: boolean
}): void {
  for (const [modelID, model] of Object.entries(input.provider.models)) {
    model.api.id = model.api.id ?? model.id ?? modelID
    if (
      modelID === "gpt-5-chat-latest" ||
      (input.providerID === ProviderID.openrouter && modelID === "openai/gpt-5-chat")
    )
      delete input.provider.models[modelID]
    if (model.status === "alpha" && !input.experimentalModels) delete input.provider.models[modelID]
    if (model.status === "deprecated") delete input.provider.models[modelID]
    if (
      (input.configProvider?.blacklist && input.configProvider.blacklist.includes(modelID)) ||
      (input.configProvider?.whitelist && !input.configProvider.whitelist.includes(modelID))
    )
      delete input.provider.models[modelID]

    model.variants = mapValues(ProviderTransform.variants(model), (v) => v)

    const configVariants = input.configProvider?.models?.[modelID]?.variants
    if (configVariants && model.variants) {
      const merged = mergeDeep(model.variants, configVariants)
      model.variants = mapValues(
        pickBy(merged, (v) => !v.disabled),
        (v) => omit(v, ["disabled"]),
      )
    }
  }
}
