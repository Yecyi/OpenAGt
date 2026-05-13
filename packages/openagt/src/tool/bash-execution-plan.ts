// Builds the security, sandbox, and permission plan for a Bash tool invocation.
// It does not ask for permissions, execute commands, or format command output.
import { Effect } from "effect"
import type { Interface as SandboxBrokerInterface } from "../sandbox/broker"
import { SandboxPolicy } from "../sandbox/policy"
import type { ResolvedPolicy } from "../sandbox/policy"
import type { SandboxBackendStatus } from "../sandbox/types"
import { ExecPolicy } from "../security/exec-policy"
import type { EvaluationResult } from "../security/exec-policy"
import { resolveExecutionDecision, strictestDecision } from "../security/decision-pipeline"
import type { ExecutionDecision } from "../security/decision-pipeline"
import { formatShellSafety, isPrivilegeEscalationCommand, ShellSecurity } from "../security/shell-security"
import type { ShellDecision, ShellSafety, ShellSecurityResult } from "../security/shell-security"
import { buildNetworkPermissionMetadata, buildShellPermissionMetadata } from "./bash-metadata"

type BashExecutionPlanLog = {
  warn(message: string, data?: Record<string, unknown>): void
}

type BashPermissionMetadata = ReturnType<typeof buildShellPermissionMetadata>

export type BashExecutionPlan = {
  security: ShellSecurityResult
  policyDecision: EvaluationResult
  decision: ExecutionDecision
  finalDecision: ShellDecision
  matchedRules: string[]
  policy: ResolvedPolicy
  shellSafety: ShellSafety
  metadata: BashPermissionMetadata
  networkMetadata: BashPermissionMetadata
}

export class BashExecutionPlanner {
  constructor(
    private readonly deps: {
      execPolicy: ExecPolicy.Interface
      log: BashExecutionPlanLog
      sandboxBroker: SandboxBrokerInterface
      sandboxPolicy: SandboxPolicy.Interface
      shellSecurity: ShellSecurity.Interface
    },
  ) {}

  plan(input: {
    command: string
    shell: string
    cwd: string
    description?: string
    externalPaths: string[]
  }): Effect.Effect<BashExecutionPlan> {
    const deps = this.deps
    return Effect.gen(function* () {
      const security = yield* deps.shellSecurity.analyze({
        command: input.command,
        shell: input.shell,
        cwd: input.cwd,
      })
      const policyDecision = yield* deps.execPolicy.evaluate({
        command: security.normalized_command || input.command,
        shellFamily: security.shell_family,
      })
      const permissionMetadata = deps.shellSecurity.createPermissionMetadata({
        result: security,
        description: input.description ?? "Shell command",
        workdir: input.cwd,
        externalPaths: input.externalPaths,
      })
      const preliminaryDecision = strictestDecision(security.decision, policyDecision.decision)
      const preliminaryPolicy = yield* deps.sandboxPolicy.resolve({
        result: security,
        decision: preliminaryDecision,
        cwd: input.cwd,
        externalPaths: input.externalPaths,
      })
      const capabilities = yield* deps.sandboxBroker.capabilities().pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            deps.log.warn("sandbox capabilities unavailable", { cause })
            return [] satisfies SandboxBackendStatus[]
          }),
        ),
      )
      const privilegeEscalation = isPrivilegeEscalationCommand(security.normalized_command || input.command)
      const decision = resolveExecutionDecision({
        securityDecision: security.decision,
        securityReason: security.explanation,
        riskLevel: security.risk_level,
        policyDecision,
        policy: preliminaryPolicy,
        capabilities,
        privilegeEscalation,
      })
      const finalDecision = decision.finalDecision
      const finalReason = decision.finalReason
      const matchedRules = decision.matchedRules
      const policy =
        finalDecision === preliminaryDecision
          ? preliminaryPolicy
          : yield* deps.sandboxPolicy.resolve({
              result: security,
              decision: finalDecision,
              cwd: input.cwd,
              externalPaths: input.externalPaths,
            })
      const backendAvailabilitySummary = decision.backendAvailability
      const shellSafety = formatShellSafety({
        decision: finalDecision,
        riskLevel: security.risk_level,
        reason: finalReason,
        approvalKind: decision.approvalKind,
        approvalRequired: finalDecision !== "allow" || policy.needs_network_permission,
        policySource: decision.policySource,
        backendPreference: policy.backend_preference,
        enforcement: policy.enforcement,
        filesystemPolicy: policy.filesystem_policy,
        networkPolicy: policy.network_policy,
        backendAvailability: backendAvailabilitySummary,
        policyReason: finalReason,
        matchedRules,
      })
      const networkReason = "Command requires network access."
      const networkShellSafety = policy.needs_network_permission
        ? formatShellSafety({
            decision: "confirm",
            riskLevel: security.risk_level,
            reason: networkReason,
            approvalKind: "network_access",
            approvalRequired: true,
            policySource: "sandbox_policy",
            backendPreference: policy.backend_preference,
            enforcement: policy.enforcement,
            filesystemPolicy: policy.filesystem_policy,
            networkPolicy: policy.network_policy,
            backendAvailability: backendAvailabilitySummary,
            policyReason: finalReason,
            matchedRules,
          })
        : undefined
      const metadata = buildShellPermissionMetadata({
        permissionMetadata,
        finalDecision,
        finalReason,
        policy,
        backendAvailabilitySummary,
        policyDecision,
        matchedRules,
        shellSafety,
      })
      const networkMetadata = buildNetworkPermissionMetadata({
        metadata,
        networkShellSafety,
        networkReason,
      })

      return {
        security,
        policyDecision,
        decision,
        finalDecision,
        matchedRules,
        policy,
        shellSafety,
        metadata,
        networkMetadata,
      }
    })
  }
}
