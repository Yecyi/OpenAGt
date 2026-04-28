// Extends the static provider catalog with provider/model entries from config.
// It does not read env/auth/plugin state, instantiate SDKs, or filter final model availability.
import { mapValues, mergeDeep, omit, pickBy } from "remeda"
import { iife } from "@/util/iife"
import type * as ModelsDev from "./models"
import { ModelID, ProviderID } from "./schema"
import type { Info, Model } from "./provider"
import * as ProviderTransform from "./transform"

type ConfigModel = {
  id?: string
  name?: string
  family?: string
  release_date?: string
  attachment?: boolean
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
  interleaved?: Model["capabilities"]["interleaved"]
  cost?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
  }
  limit?: {
    context: number
    input?: number
    output: number
  }
  modalities?: {
    input: Array<"text" | "audio" | "image" | "video" | "pdf">
    output: Array<"text" | "audio" | "image" | "video" | "pdf">
  }
  status?: "alpha" | "beta" | "deprecated"
  provider?: { npm?: string; api?: string }
  options?: Record<string, unknown>
  headers?: Record<string, string>
  variants?: Record<string, Record<string, unknown> & { disabled?: boolean }>
}

type ConfigProvider = {
  api?: string
  name?: string
  env?: string[]
  npm?: string
  options?: Record<string, unknown>
  models?: Record<string, ConfigModel>
}

export function extendCatalogWithConfigProviders(input: {
  database: Record<string, Info>
  modelsDev: Record<string, ModelsDev.Provider>
  configProviders: Array<[string, ConfigProvider]>
}): void {
  for (const [providerID, provider] of input.configProviders) {
    const existing = input.database[providerID]
    const parsed: Info = {
      id: ProviderID.make(providerID),
      name: provider.name ?? existing?.name ?? providerID,
      env: provider.env ?? existing?.env ?? [],
      options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
      source: "config",
      models: existing?.models ?? {},
    }

    for (const [modelID, model] of Object.entries(provider.models ?? {})) {
      const existingModel = parsed.models[model.id ?? modelID]
      const name = iife(() => {
        if (model.name) return model.name
        if (model.id && model.id !== modelID) return modelID
        return existingModel?.name ?? modelID
      })
      const parsedModel: Model = {
        id: ModelID.make(modelID),
        api: {
          id: model.id ?? existingModel?.api.id ?? modelID,
          npm:
            model.provider?.npm ??
            provider.npm ??
            existingModel?.api.npm ??
            input.modelsDev[providerID]?.npm ??
            "@ai-sdk/openai-compatible",
          url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? input.modelsDev[providerID]?.api ?? "",
        },
        status: model.status ?? existingModel?.status ?? "active",
        name,
        providerID: ProviderID.make(providerID),
        capabilities: {
          temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
          reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
          attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
          toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
          input: {
            text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
            audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
            image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
            video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
            pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
          },
          output: {
            text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
            audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
            image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
            video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
            pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
          },
          interleaved: model.interleaved ?? false,
        },
        cost: {
          input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
          output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
          cache: {
            read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
            write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
          },
        },
        options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
        limit: {
          context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
          input: model.limit?.input ?? existingModel?.limit?.input,
          output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
        },
        headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
        family: model.family ?? existingModel?.family ?? "",
        release_date: model.release_date ?? existingModel?.release_date ?? "",
        variants: {},
      }
      const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
      parsedModel.variants = mapValues(
        pickBy(merged, (v) => !v.disabled),
        (v) => omit(v, ["disabled"]),
      )
      parsed.models[modelID] = parsedModel
    }
    input.database[providerID] = parsed
  }
}
