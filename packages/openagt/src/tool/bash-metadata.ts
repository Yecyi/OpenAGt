// Builds Bash tool permission/result metadata from security and sandbox decisions.
// It does not execute commands, ask permissions, or choose sandbox backends.
import type * as Tool from "./tool"
import type { ExecPolicyDecision, EvaluationResult } from "@/security/exec-policy"
import type { ExecutionDecision } from "@/security/decision-pipeline"
import type { RunResult } from "@/shell/runner"
import type {
  ShellDecision,
  ShellFinding,
  ShellRiskLevel,
  ShellSafety,
  ShellSecurityResult,
} from "../security/shell-security"
import type { ResolvedPolicy } from "@/sandbox/policy"
import type {
  SandboxBackendPreference,
  SandboxEnforcement,
  SandboxFilesystemPolicy,
  SandboxNetworkPolicy,
} from "@/sandbox/types"

export type BashMetadata = {
  output: string
  exit: number | null
  description: string
  truncated: boolean
  findings: ShellFinding[]
  riskLevel: ShellRiskLevel
  decision: ShellDecision
  reviewApiVersion: 1
  reviewMode: "disabled"
  reviewStatus: "not_requested"
  policyDecision?: ExecPolicyDecision
  policyReason?: string
  matchedRules?: string[]
  shell_safety?: ShellSafety
  safetySummary?: string
  safetyDetails?: string[]
  outputPath?: string
  backendPreference?: SandboxBackendPreference
  enforcement?: SandboxEnforcement
  filesystemPolicy?: SandboxFilesystemPolicy
  networkPolicy?: SandboxNetworkPolicy
  allowedPaths?: string[]
  writablePaths?: string[]
  backendUsed?: string
  terminationReason?: string
  sandboxEnforced?: boolean
  filesystemEnforced?: boolean
  networkEnforced?: boolean
  sandboxDowngradeReason?: string
}

export function buildShellPermissionMetadata(input: {
  permissionMetadata: Record<string, unknown>
  finalDecision: ShellDecision
  finalReason: string
  policy: ResolvedPolicy
  backendAvailabilitySummary: string
  policyDecision: EvaluationResult
  matchedRules: string[]
  shellSafety: ShellSafety
}) {
  return {
    ...input.permissionMetadata,
    decision: input.finalDecision,
    reason: input.finalReason,
    backendPreference: input.policy.backend_preference,
    enforcement: input.policy.enforcement,
    filesystemPolicy: input.policy.filesystem_policy,
    networkPolicy: input.policy.network_policy,
    allowedPathsSummary: input.policy.allowed_paths,
    backendAvailability: input.backendAvailabilitySummary,
    ...(input.policyDecision.matchedRules.length > 0 ? { policyDecision: input.policyDecision.decision } : {}),
    ...(input.policyDecision.matchedRules.length > 0 ? { policyReason: input.policyDecision.reason } : {}),
    ...(input.matchedRules.length > 0 ? { matchedRules: input.matchedRules } : {}),
    shell_safety: input.shellSafety,
    safetySummary: input.shellSafety.summary,
    safetyDetails: input.shellSafety.details,
  }
}

export function buildNetworkPermissionMetadata(input: {
  metadata: ReturnType<typeof buildShellPermissionMetadata>
  networkShellSafety?: ShellSafety
  networkReason: string
}) {
  if (!input.networkShellSafety) return input.metadata
  return {
    ...input.metadata,
    decision: "confirm" as const,
    reason: input.networkReason,
    shell_safety: input.networkShellSafety,
    safetySummary: input.networkShellSafety.summary,
    safetyDetails: input.networkShellSafety.details,
  }
}

export function buildBlockedCommandResult(input: {
  description: string
  security: ShellSecurityResult
  decision: ExecutionDecision
  policyDecision: EvaluationResult
  shellSafety: ShellSafety
}): Tool.ExecuteResult<BashMetadata> {
  const errorMsg = input.shellSafety.summary
  return {
    title: "Bash Command Blocked",
    metadata: {
      output: errorMsg,
      exit: null as number | null,
      description: input.description,
      truncated: false,
      findings: input.security.findings,
      riskLevel: input.security.risk_level,
      decision: input.decision.finalDecision,
      reviewApiVersion: input.security.review_api_version,
      reviewMode: input.security.review_mode,
      reviewStatus: input.security.review_status,
      ...(input.policyDecision.matchedRules.length > 0 ? { policyDecision: input.policyDecision.decision } : {}),
      ...(input.policyDecision.matchedRules.length > 0 ? { policyReason: input.policyDecision.reason } : {}),
      ...(input.decision.matchedRules.length > 0 ? { matchedRules: input.decision.matchedRules } : {}),
      shell_safety: input.shellSafety,
      safetySummary: input.shellSafety.summary,
      safetyDetails: input.shellSafety.details,
    },
    output: errorMsg,
  }
}

export function addShellReviewMetadata(input: {
  result: RunResult
  security: ShellSecurityResult
  finalDecision: ShellDecision
  policyDecision: EvaluationResult
  matchedRules: string[]
  shellSafety: ShellSafety
}): Tool.ExecuteResult<BashMetadata> {
  return {
    ...input.result,
    metadata: {
      ...input.result.metadata,
      findings: input.security.findings,
      riskLevel: input.security.risk_level,
      decision: input.finalDecision,
      reviewApiVersion: input.security.review_api_version,
      reviewMode: input.security.review_mode,
      reviewStatus: input.security.review_status,
      ...(input.policyDecision.matchedRules.length > 0 ? { policyDecision: input.policyDecision.decision } : {}),
      ...(input.policyDecision.matchedRules.length > 0 ? { policyReason: input.policyDecision.reason } : {}),
      ...(input.matchedRules.length > 0 ? { matchedRules: input.matchedRules } : {}),
      shell_safety: input.shellSafety,
      safetySummary: input.shellSafety.summary,
      safetyDetails: input.shellSafety.details,
    },
  }
}
