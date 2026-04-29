// Defines shared reasoning-effort lists and model-specific adaptive effort detection.
// It does not build provider option payloads or load model catalogs.

export const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
export const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]

export function anthropicAdaptiveEfforts(apiId: string): string[] | null {
  if (["opus-4-7", "opus-4.7"].some((v) => apiId.includes(v))) {
    return ["low", "medium", "high", "xhigh", "max"]
  }
  if (["opus-4-6", "opus-4.6", "sonnet-4-6", "sonnet-4.6"].some((v) => apiId.includes(v))) {
    return ["low", "medium", "high", "max"]
  }
  return null
}
