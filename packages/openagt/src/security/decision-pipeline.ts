import { autoBackendName } from "@/sandbox/backends"
import type { ResolvedPolicy } from "@/sandbox/policy"
import type {
  SandboxBackendName,
  SandboxBackendPreference,
  SandboxBackendStatus,
  SandboxNativeReadiness,
} from "@/sandbox/types"
import type { EvaluationResult, ExecPolicyDecision } from "./exec-policy"
import { classifyApprovalKind, type ShellApprovalKind, type ShellDecision, type ShellRiskLevel } from "./shell-security"
import type { ShellSafety } from "./shell-security"

const DECISION_ORDER: Record<ShellDecision, number> = {
  allow: 0,
  confirm: 1,
  block: 2,
}

type PipelinePolicy = Pick<
  ResolvedPolicy,
  "sandbox" | "backend_preference" | "network_policy" | "needs_network_permission"
>

export type ExecutionDecision = {
  preliminaryDecision: ShellDecision
  finalDecision: ShellDecision
  finalReason: string
  approvalKind: ShellApprovalKind
  policySource: ShellSafety["policy"]["source"]
  backendAvailability: string
  matchedRules: string[]
  sandboxEscalationReason?: string
}

export function strictestDecision(left: ShellDecision, right: ExecPolicyDecision): ShellDecision {
  return DECISION_ORDER[left] >= DECISION_ORDER[right] ? left : right
}

function forceDecision(left: ShellDecision, right: ShellDecision) {
  return DECISION_ORDER[left] >= DECISION_ORDER[right] ? left : right
}

function isRisky(riskLevel: ShellRiskLevel) {
  return riskLevel === "medium" || riskLevel === "high"
}

export function preferredBackendName(preference: SandboxBackendPreference): SandboxBackendName | undefined {
  if (preference !== "auto") return preference
  return autoBackendName()
}

export function preferredBackendStatus(preference: SandboxBackendPreference, capabilities: SandboxBackendStatus[]) {
  const name = preferredBackendName(preference)
  if (!name) return
  return capabilities.find((item) => item.name === name)
}

function processBackendStatus(capabilities: SandboxBackendStatus[]) {
  return capabilities.find((item) => item.name === "process")
}

function backendFallback(input: { preference: SandboxBackendPreference; capabilities: SandboxBackendStatus[] }) {
  return preferredBackendStatus(input.preference, input.capabilities)
}

export function backendAvailability(preference: SandboxBackendPreference, capabilities: SandboxBackendStatus[]) {
  const backend = backendFallback({ preference, capabilities })
  if (!backend) return preference === "auto" ? "auto:unknown" : `${preference}:unknown`
  if (backend.available && backend.name === "process") {
    return preference === "auto"
      ? "process:available (auto fallback; no OS-native isolation)"
      : "process:available (no OS-native isolation)"
  }
  const readinessReason = backend.name !== "process" ? nativeReadinessReason(backend.readiness) : undefined
  if (backend.available && readinessReason) return `${backend.name}:not-ready (${readinessReason})`
  if (backend.available) return `${backend.name}:available`
  return `${backend.name}:unavailable${backend.reason ? ` (${backend.reason})` : ""}`
}

function processOnly(input: { preference: SandboxBackendPreference; capabilities: SandboxBackendStatus[] }) {
  const backend = backendFallback(input)
  return Boolean(backend?.available && backend.name === "process")
}

function nativeUnavailable(input: { preference: SandboxBackendPreference; capabilities: SandboxBackendStatus[] }) {
  if (input.preference !== "auto" && input.preference !== "process") {
    return !nativeReady(preferredBackendStatus(input.preference, input.capabilities))
  }
  if (input.preference === "process") return false
  const native = preferredBackendStatus(input.preference, input.capabilities)
  return native?.name !== "process" && !nativeReady(native)
}

function nativeNetworkUnsupported(input: {
  preference: SandboxBackendPreference
  capabilities: SandboxBackendStatus[]
  networkPolicy: PipelinePolicy["network_policy"]
}) {
  if (input.networkPolicy === "full") return false
  const backend = preferredBackendStatus(input.preference, input.capabilities)
  const supported =
    backend?.network_policies_enforced?.includes(input.networkPolicy) ??
    (backend?.network_enforced && input.networkPolicy === "none")
  return Boolean(backend?.available && backend.name !== "process" && !supported)
}

function unavailableReason(preference: SandboxBackendPreference, capabilities: SandboxBackendStatus[]) {
  const backend = preferredBackendStatus(preference, capabilities)
  const readinessReason = backend?.name !== "process" ? nativeReadinessReason(backend?.readiness) : undefined
  if (readinessReason) return ` (${readinessReason})`
  return backend?.reason ? ` (${backend.reason})` : ""
}

function nativeReady(backend: SandboxBackendStatus | undefined) {
  if (!backend?.available) return false
  if (backend.name === "process") return true
  return !nativeReadinessReason(backend.readiness)
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

function sandboxDecision(input: {
  preliminaryDecision: ShellDecision
  policy: PipelinePolicy
  capabilities: SandboxBackendStatus[]
  riskLevel: ShellRiskLevel
  matchedRules: string[]
  privilegeEscalation: boolean
}) {
  if (input.preliminaryDecision === "block") return
  if (nativeUnavailable({ preference: input.policy.backend_preference, capabilities: input.capabilities })) {
    const backendLabel =
      input.policy.backend_preference === "auto" ? "sandbox backend" : `sandbox backend ${input.policy.backend_preference}`
    if (input.policy.sandbox.failure_policy === "closed") {
      return {
        decision: "block" as const,
        reason:
          input.policy.backend_preference === "auto"
            ? `Required sandbox backend is unavailable${unavailableReason(input.policy.backend_preference, input.capabilities)}.`
            : `Required sandbox backend ${input.policy.backend_preference} is unavailable${unavailableReason(input.policy.backend_preference, input.capabilities)}.`,
      }
    }
    if (input.policy.sandbox.failure_policy === "confirm_downgrade" || isRisky(input.riskLevel)) {
      return {
        decision: "confirm" as const,
        reason: `${backendLabel[0]?.toUpperCase()}${backendLabel.slice(1)} is unavailable; confirmation required before downgrade.`,
      }
    }
  }
  if (
    nativeNetworkUnsupported({
      preference: input.policy.backend_preference,
      capabilities: input.capabilities,
      networkPolicy: input.policy.network_policy,
    })
  ) {
    if (input.policy.sandbox.failure_policy === "closed") {
      return {
        decision: "block" as const,
        reason: `Required sandbox backend cannot enforce ${input.policy.network_policy} network policy.`,
      }
    }
    return {
      decision: "confirm" as const,
      reason: `Sandbox backend cannot enforce ${input.policy.network_policy} network policy; confirmation required before downgrade.`,
    }
  }
  if (isRisky(input.riskLevel) && processOnly({ preference: input.policy.backend_preference, capabilities: input.capabilities })) {
    if (input.policy.sandbox.failure_policy === "closed") {
      return {
        decision: "block" as const,
        reason: "Required OS-native sandbox is unavailable; process backend provides no OS isolation.",
      }
    }
    return {
      decision: "confirm" as const,
      reason: "Only process-level sandbox is available; confirmation required before running without OS-native isolation.",
    }
  }
  if (
    input.policy.backend_preference !== "auto" &&
    input.policy.backend_preference !== "process" &&
    nativeUnavailable({ preference: input.policy.backend_preference, capabilities: input.capabilities })
  ) {
    if (input.policy.sandbox.failure_policy === "closed") {
      return {
        decision: "block" as const,
        reason: `Required sandbox backend ${input.policy.backend_preference} is unavailable${unavailableReason(input.policy.backend_preference, input.capabilities)}.`,
      }
    }
    return {
      decision: "confirm" as const,
      reason: `Sandbox backend ${input.policy.backend_preference} is unavailable; confirmation required before downgrade.`,
    }
  }
  if (input.matchedRules.length > 0 || input.privilegeEscalation || input.policy.needs_network_permission) return
  if (!input.policy.sandbox.enabled) {
    return {
      decision: "confirm" as const,
      reason: "Sandbox is disabled; confirmation required before running without isolation.",
    }
  }
  if (input.policy.sandbox.report_only) {
    return {
      decision: "confirm" as const,
      reason: "Sandbox enforcement is in report-only mode; confirmation required before running without enforcement.",
    }
  }
}

export function resolveExecutionDecision(input: {
  securityDecision: ShellDecision
  securityReason: string
  riskLevel: ShellRiskLevel
  policyDecision: EvaluationResult
  policy: PipelinePolicy
  capabilities: SandboxBackendStatus[]
  privilegeEscalation: boolean
}): ExecutionDecision {
  const matchedRules = input.policyDecision.matchedRules.map((item) => item.pattern.join(" "))
  const preliminaryDecision = strictestDecision(input.securityDecision, input.policyDecision.decision)
  const policyMatched = matchedRules.length > 0 && preliminaryDecision === input.policyDecision.decision
  const preliminaryReason = policyMatched ? input.policyDecision.reason : input.securityReason
  const sandbox = sandboxDecision({
    preliminaryDecision,
    policy: input.policy,
    capabilities: input.capabilities,
    riskLevel: input.riskLevel,
    matchedRules,
    privilegeEscalation: input.privilegeEscalation,
  })
  const finalDecision = sandbox ? forceDecision(preliminaryDecision, sandbox.decision) : preliminaryDecision
  const finalReason = sandbox && finalDecision === sandbox.decision ? sandbox.reason : preliminaryReason
  const policySource: ShellSafety["policy"]["source"] = sandbox
    ? "sandbox_policy"
    : policyMatched
      ? "exec_policy"
      : input.policy.needs_network_permission
        ? "sandbox_policy"
        : "shell_security"

  return {
    preliminaryDecision,
    finalDecision,
    finalReason,
    approvalKind: classifyApprovalKind({
      decision: finalDecision,
      reason: finalReason,
      matchedRules,
      needsNetworkPermission: input.policy.needs_network_permission,
      privilegeEscalation: input.privilegeEscalation,
      sandboxEscalation: Boolean(sandbox),
    }),
    policySource,
    backendAvailability: backendAvailability(input.policy.backend_preference, input.capabilities),
    matchedRules,
    ...(sandbox ? { sandboxEscalationReason: sandbox.reason } : {}),
  }
}
