// Formats shell safety metadata and approval classification.
// It does not analyze commands, strip wrappers, or assign risk levels.
import type { ShellApprovalKind, ShellDecision, ShellSafety, ShellSafetyInput } from "./shell-security"

function decisionLabel(decision: ShellDecision) {
  if (decision === "block") return "Blocked"
  if (decision === "confirm") return "Confirmation required"
  return "Allowed"
}

function approvalReviewable(kind: ShellApprovalKind) {
  return kind === "exec_policy_rule" || kind === "network_access" || kind === "sandbox_escalation"
}

export function classifyApprovalKind(input: {
  decision: ShellDecision
  reason: string
  matchedRules?: string[]
  needsNetworkPermission?: boolean
  privilegeEscalation?: boolean
  sandboxEscalation?: boolean
}): ShellApprovalKind {
  if (input.privilegeEscalation) return "privilege_escalation"
  if (input.matchedRules?.length) return "exec_policy_rule"
  if (input.decision === "block") return "dangerous_command"
  if (input.sandboxEscalation) return "sandbox_escalation"
  if (input.needsNetworkPermission) return "network_access"
  return "dangerous_command"
}

export function isPrivilegeEscalationCommand(command: string) {
  return /\b(sudo|su|doas|runas)\b/i.test(command) || /start-process\s+-verb\s+runas/i.test(command)
}

export function formatShellSafety(input: ShellSafetyInput): ShellSafety {
  const approvalRequired = input.approvalRequired ?? input.decision !== "allow"
  const policyReason = input.policyReason ?? input.reason
  const summary = `${decisionLabel(input.decision)}: ${input.reason}`
  const details = [
    `Risk: ${input.riskLevel}`,
    `Approval: ${approvalRequired ? input.approvalKind : "none"}`,
    `Policy: ${policyReason}`,
    ...(input.backendPreference || input.enforcement
      ? [
          `Boundary: ${[
            input.backendPreference ? `backend=${input.backendPreference}` : undefined,
            input.enforcement ? `enforcement=${input.enforcement}` : undefined,
          ]
            .filter(Boolean)
            .join(", ")}`,
        ]
      : []),
    ...(input.filesystemPolicy ? [`Filesystem: ${input.filesystemPolicy}`] : []),
    ...(input.networkPolicy ? [`Network: ${input.networkPolicy}`] : []),
    ...(input.matchedRules?.length ? [`Matched rules: ${input.matchedRules.join(", ")}`] : []),
  ]
  return {
    version: 1,
    summary,
    details,
    decision: input.decision,
    risk_level: input.riskLevel,
    reason: input.reason,
    boundary: {
      ...(input.backendPreference ? { backend_preference: input.backendPreference } : {}),
      ...(input.backendAvailability ? { backend_availability: input.backendAvailability } : {}),
      ...(input.enforcement ? { enforcement: input.enforcement } : {}),
      ...(input.filesystemPolicy ? { filesystem_policy: input.filesystemPolicy } : {}),
      ...(input.networkPolicy ? { network_policy: input.networkPolicy } : {}),
    },
    approval: {
      required: approvalRequired,
      kind: input.approvalKind,
      reviewer: approvalRequired ? "user" : "disabled",
      reviewable: approvalRequired && approvalReviewable(input.approvalKind),
    },
    policy: {
      source: input.policySource,
      reason: policyReason,
      matched_rules: input.matchedRules ?? [],
    },
  }
}
