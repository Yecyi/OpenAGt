import { autoBackendName } from "@/sandbox/backends"
import type { ResolvedPolicy } from "@/sandbox/policy"
import type {
  SandboxBackendName,
  SandboxBackendPreference,
  SandboxBackendStatus,
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
  "sandbox" | "backend_preference" | "needs_network_permission"
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
  const preferred = preferredBackendStatus(input.preference, input.capabilities)
  if (input.preference !== "auto") return preferred
  if (preferred?.available) return preferred
  return processBackendStatus(input.capabilities) ?? preferred
}

export function backendAvailability(preference: SandboxBackendPreference, capabilities: SandboxBackendStatus[]) {
  const backend = backendFallback({ preference, capabilities })
  if (!backend) return preference === "auto" ? "auto:unknown" : `${preference}:unknown`
  if (backend.available && backend.name === "process") {
    return preference === "auto"
      ? "process:available (auto fallback; no OS-native isolation)"
      : "process:available (no OS-native isolation)"
  }
  if (backend.available) return `${backend.name}:available`
  return `${backend.name}:unavailable${backend.reason ? ` (${backend.reason})` : ""}`
}

function processOnly(input: { preference: SandboxBackendPreference; capabilities: SandboxBackendStatus[] }) {
  const backend = backendFallback(input)
  return Boolean(backend?.available && backend.name === "process")
}

function nativeUnavailable(input: { preference: SandboxBackendPreference; capabilities: SandboxBackendStatus[] }) {
  if (input.preference !== "auto" && input.preference !== "process") {
    return !preferredBackendStatus(input.preference, input.capabilities)?.available
  }
  if (input.preference === "process") return false
  const native = preferredBackendStatus(input.preference, input.capabilities)
  return native?.name !== "process" && !native?.available
}

function unavailableReason(preference: SandboxBackendPreference, capabilities: SandboxBackendStatus[]) {
  const backend = preferredBackendStatus(preference, capabilities)
  return backend?.reason ? ` (${backend.reason})` : ""
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
  if (isRisky(input.riskLevel) && nativeUnavailable({ preference: input.policy.backend_preference, capabilities: input.capabilities })) {
    if (input.policy.sandbox.failure_policy === "closed") {
      return {
        decision: "block" as const,
        reason: `Required sandbox backend is unavailable${unavailableReason(input.policy.backend_preference, input.capabilities)}.`,
      }
    }
    return {
      decision: "confirm" as const,
      reason: "Sandbox backend is unavailable; confirmation required before downgrade.",
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
