// Helper decisions shared by provider-specific custom loaders.
// It does not read config/auth/env or instantiate provider SDKs.
export function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

export function useLanguageModel(sdk: any): boolean {
  return sdk.responses === undefined && sdk.chat === undefined
}
