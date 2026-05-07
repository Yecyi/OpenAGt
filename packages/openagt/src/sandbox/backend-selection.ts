import type { SandboxBackendName, SandboxBackendPreference, SandboxBackendStatus, SandboxFailurePolicy } from "./types"

export type BackendSelection =
  | {
      type: "run"
      backend: SandboxBackendStatus
      downgradeReason?: string
    }
  | {
      type: "deny"
      backendUsed: SandboxBackendName
      reason: string
    }

export function selectBackend(input: {
  backends: ReadonlyMap<SandboxBackendName, { status: SandboxBackendStatus }>
  backendPreference: SandboxBackendPreference
  failurePolicy: SandboxFailurePolicy
  autoBackendName: SandboxBackendName
}): BackendSelection {
  const preferredName = input.backendPreference === "auto" ? input.autoBackendName : input.backendPreference
  const preferred = input.backends.get(preferredName)?.status
  if (preferred?.available) return { type: "run", backend: preferred }
  const reason = preferred?.reason ?? `Sandbox backend unavailable: ${preferredName}`
  if (input.failurePolicy === "closed") {
    return {
      type: "deny",
      backendUsed: preferredName,
      reason,
    }
  }
  const processBackend = input.backends.get("process")?.status
  if (processBackend?.available) {
    return {
      type: "run",
      backend: processBackend,
      downgradeReason: reason,
    }
  }
  return {
    type: "deny",
    backendUsed: preferredName,
    reason: processBackend?.reason ?? reason,
  }
}
