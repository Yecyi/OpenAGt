export type ShellApprovalKind =
  | "exec_policy_rule"
  | "sandbox_escalation"
  | "network_access"
  | "privilege_escalation"
  | "dangerous_command"

export type ShellSafety = {
  summary: string
  details: string[]
  decision: "allow" | "confirm" | "block"
  risk_level: "safe" | "low" | "medium" | "high"
  reason: string
  boundary: {
    backend_preference?: string
    backend_availability?: string
    enforcement?: string
    filesystem_policy?: string
    network_policy?: string
  }
  approval: {
    required: boolean
    kind: ShellApprovalKind
    reviewer: "user" | "disabled"
    reviewable: boolean
  }
  policy: {
    source: "shell_security" | "exec_policy" | "sandbox_policy"
    reason: string
    matched_rules: string[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isDecision(value: unknown): value is ShellSafety["decision"] {
  return value === "allow" || value === "confirm" || value === "block"
}

function isRiskLevel(value: unknown): value is ShellSafety["risk_level"] {
  return value === "safe" || value === "low" || value === "medium" || value === "high"
}

function isApprovalKind(value: unknown): value is ShellApprovalKind {
  return (
    value === "exec_policy_rule" ||
    value === "sandbox_escalation" ||
    value === "network_access" ||
    value === "privilege_escalation" ||
    value === "dangerous_command"
  )
}

function isPolicySource(value: unknown): value is ShellSafety["policy"]["source"] {
  return value === "shell_security" || value === "exec_policy" || value === "sandbox_policy"
}

export function getShellSafety(metadata: Record<string, unknown> | null | undefined) {
  const candidate = metadata?.["shell_safety"]
  if (!isRecord(candidate)) return
  if (typeof candidate.summary !== "string") return
  if (!Array.isArray(candidate.details) || candidate.details.some((item) => typeof item !== "string")) return
  if (!isDecision(candidate.decision)) return
  if (!isRiskLevel(candidate.risk_level)) return
  if (typeof candidate.reason !== "string") return
  if (!isRecord(candidate.boundary)) return
  if (!isRecord(candidate.approval)) return
  if (!isRecord(candidate.policy)) return
  if (typeof candidate.approval.required !== "boolean") return
  if (!isApprovalKind(candidate.approval.kind)) return
  if (candidate.approval.reviewer !== "user" && candidate.approval.reviewer !== "disabled") return
  if (typeof candidate.approval.reviewable !== "boolean") return
  if (!isPolicySource(candidate.policy.source)) return
  if (typeof candidate.policy.reason !== "string") return
  if (
    !Array.isArray(candidate.policy.matched_rules) ||
    candidate.policy.matched_rules.some((item) => typeof item !== "string")
  )
    return
  return candidate as ShellSafety
}
