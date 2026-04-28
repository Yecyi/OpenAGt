import { describe, expect, test } from "bun:test"
import { ProviderID, ModelID } from "../../src/provider/schema"
import type { Info, Model } from "../../src/provider/provider"
import { applyModelCatalogPolicy } from "../../src/provider/model-catalog-policy"

const modalities = { text: true, audio: false, image: false, video: false, pdf: false }

function model(id: string, patch: Partial<Model> = {}): Model {
  return {
    id: ModelID.make(id),
    providerID: ProviderID.openai,
    api: { id: "", url: "https://example.com", npm: "@ai-sdk/openai" },
    name: id,
    family: "",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: modalities,
      output: modalities,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 16_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
    variants: {},
    ...patch,
  }
}

function provider(providerID: ProviderID, models: Record<string, Model>): Info {
  return {
    id: providerID,
    name: String(providerID),
    source: "config",
    env: [],
    options: {},
    models,
  }
}

describe("provider model catalog policy", () => {
  test("filters alpha and deprecated models while preserving active models", () => {
    const item = provider(ProviderID.openai, {
      active: model("active"),
      alpha: model("alpha", { status: "alpha" }),
      deprecated: model("deprecated", { status: "deprecated" }),
    })

    applyModelCatalogPolicy({ providerID: ProviderID.openai, provider: item, experimentalModels: false })

    expect(Object.keys(item.models)).toEqual(["active"])
  })

  test("applies whitelist and blacklist together", () => {
    const item = provider(ProviderID.openai, {
      keep: model("keep"),
      deny: model("deny"),
      outside: model("outside"),
    })

    applyModelCatalogPolicy({
      providerID: ProviderID.openai,
      provider: item,
      configProvider: { whitelist: ["keep", "deny"], blacklist: ["deny"] },
      experimentalModels: true,
    })

    expect(Object.keys(item.models)).toEqual(["keep"])
  })

  test("removes gpt-5 chat compatibility entries", () => {
    const openai = provider(ProviderID.openai, {
      "gpt-5-chat-latest": model("gpt-5-chat-latest"),
      "gpt-5": model("gpt-5"),
    })
    const openrouter = provider(ProviderID.openrouter, {
      "openai/gpt-5-chat": model("openai/gpt-5-chat", { providerID: ProviderID.openrouter }),
      "openai/gpt-5": model("openai/gpt-5", { providerID: ProviderID.openrouter }),
    })

    applyModelCatalogPolicy({ providerID: ProviderID.openai, provider: openai, experimentalModels: true })
    applyModelCatalogPolicy({ providerID: ProviderID.openrouter, provider: openrouter, experimentalModels: true })

    expect(Object.keys(openai.models)).toEqual(["gpt-5"])
    expect(Object.keys(openrouter.models)).toEqual(["openai/gpt-5"])
  })

  test("merges variants and removes disabled variants", () => {
    const item = provider(ProviderID.openai, {
      "gpt-5": model("gpt-5"),
    })

    applyModelCatalogPolicy({
      providerID: ProviderID.openai,
      provider: item,
      configProvider: {
        models: {
          "gpt-5": {
            variants: {
              low: { disabled: true },
              custom: { reasoningEffort: "custom" },
            },
          },
        },
      },
      experimentalModels: true,
    })

    expect(item.models["gpt-5"].variants?.low).toBeUndefined()
    expect(item.models["gpt-5"].variants?.custom).toEqual({ reasoningEffort: "custom" })
    expect(item.models["gpt-5"].variants?.medium).toBeDefined()
  })
})
