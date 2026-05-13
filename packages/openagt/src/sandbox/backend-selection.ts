import type {
  SandboxBackendName,
  SandboxBackendPreference,
  SandboxBackendStatus,
  SandboxFailurePolicy,
  SandboxNativeReadiness,
  SandboxNetworkPolicy,
} from "./types"

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
  networkPolicy?: SandboxNetworkPolicy
}): BackendSelection {
  const networkPolicy = input.networkPolicy ?? "full"
  const preferredName = input.backendPreference === "auto" ? input.autoBackendName : input.backendPreference
  const preferred = input.backends.get(preferredName)?.status
  const readinessReason = preferred?.name !== "process" ? nativeReadinessReason(preferred?.readiness) : undefined
  const networkSupported =
    networkPolicy === "full" ||
    Boolean(
      preferred?.network_policies_enforced?.includes(networkPolicy) ??
        (preferred?.network_enforced && networkPolicy === "none"),
    )
  const networkReason =
    preferred?.available && preferred.name !== "process" && !readinessReason && !networkSupported
      ? `${preferred.name} does not enforce ${networkPolicy} network policy`
      : undefined
  if (preferred?.available && !readinessReason && !networkReason) return { type: "run", backend: preferred }
  const reason =
    readinessReason ?? networkReason ?? preferred?.reason ?? `Sandbox backend unavailable: ${preferredName}`
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

function nativeReadinessReason(readiness: SandboxNativeReadiness | undefined) {
  if (!readiness || readiness === "ready") return
  if (readiness === "helper_missing") return "Windows native helper is missing"
  if (readiness === "helper_version_mismatch") return "Windows helper protocol or version is incompatible"
  if (readiness === "setup_required") return "Windows sandbox setup is required before native sandbox can run"
  if (readiness === "admin_verification_required") return "Windows sandbox admin verification gate has not passed"
  if (readiness === "acl_apply_required") return "Windows filesystem ACL enforcement is not enabled"
  if (readiness === "network_policy_unsupported") return "Requested Windows sandbox network policy is not supported"
  return "Windows native sandbox backend is unavailable"
}
