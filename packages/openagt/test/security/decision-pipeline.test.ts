import { describe, expect, test } from "bun:test"
import { resolveExecutionDecision, strictestDecision } from "../../src/security/decision-pipeline"
import type { EvaluationResult } from "../../src/security/exec-policy"
import type {
  SandboxBackendPreference,
  SandboxBackendStatus,
  SandboxFailurePolicy,
  SandboxNetworkPolicy,
} from "../../src/sandbox/types"

const evalResult = (decision: EvaluationResult["decision"], matched = false): EvaluationResult => ({
  tokens: ["cmd"],
  decision,
  reason: matched ? "Matched policy rule." : "No exec policy rule matched.",
  matchedRules: matched ? [{ index: 0, pattern: ["cmd"], decision, justification: "Matched policy rule." }] : [],
})

const policy = (
  backend: SandboxBackendPreference,
  failurePolicy: SandboxFailurePolicy,
  network = false,
) => {
  const networkPolicy: SandboxNetworkPolicy = network ? "full" : "none"
  return {
    sandbox: {
      enabled: true,
      backend,
      failure_policy: failurePolicy,
      report_only: false,
      broker_idle_ttl_ms: 300_000,
    },
    backend_preference: backend,
    network_policy: networkPolicy,
    needs_network_permission: network,
  }
}

const processOnly: SandboxBackendStatus[] = [{ name: "process", available: true }]
const windowsNativeUnavailable: SandboxBackendStatus[] = [
  {
    name: "windows_native",
    available: false,
    reason: "Windows native helper run loop is not implemented yet",
  },
  { name: "process", available: true },
]
const windowsNativeFilesystemOnly: SandboxBackendStatus[] = [
  {
    name: "windows_native",
    available: true,
    filesystem_enforced: true,
    network_enforced: false,
  },
  { name: "process", available: true },
]

describe("execution decision pipeline", () => {
  test("keeps strictest shell and exec-policy decision", () => {
    expect(strictestDecision("allow", "block")).toBe("block")
    expect(strictestDecision("confirm", "allow")).toBe("confirm")
  })

  test("blocks medium risk when closed policy only has process isolation", () => {
    const decision = resolveExecutionDecision({
      securityDecision: "allow",
      securityReason: "No risky shell features detected.",
      riskLevel: "medium",
      policyDecision: evalResult("allow"),
      policy: policy("process", "closed"),
      capabilities: processOnly,
      privilegeEscalation: false,
    })

    expect(decision.finalDecision).toBe("block")
    expect(decision.policySource).toBe("sandbox_policy")
    expect(decision.finalReason).toContain("no OS isolation")
  })

  test("upgrades medium process-only fallback to confirmation", () => {
    const decision = resolveExecutionDecision({
      securityDecision: "allow",
      securityReason: "No risky shell features detected.",
      riskLevel: "medium",
      policyDecision: evalResult("allow"),
      policy: policy("process", "fallback"),
      capabilities: processOnly,
      privilegeEscalation: false,
    })

    expect(decision.finalDecision).toBe("confirm")
    expect(decision.approvalKind).toBe("sandbox_escalation")
  })

  test("leaves safe process-only commands allowed", () => {
    const decision = resolveExecutionDecision({
      securityDecision: "allow",
      securityReason: "No risky shell features detected.",
      riskLevel: "safe",
      policyDecision: evalResult("allow"),
      policy: policy("process", "closed"),
      capabilities: processOnly,
      privilegeEscalation: false,
    })

    expect(decision.finalDecision).toBe("allow")
    expect(decision.backendAvailability).toContain("no OS-native isolation")
  })

  test("blocks auto native-unavailable commands when failure policy is closed", () => {
    const decision = resolveExecutionDecision({
      securityDecision: "allow",
      securityReason: "No risky shell features detected.",
      riskLevel: "safe",
      policyDecision: evalResult("allow"),
      policy: policy("auto", "closed"),
      capabilities: windowsNativeUnavailable,
      privilegeEscalation: false,
    })

    expect(decision.finalDecision).toBe("block")
    expect(decision.policySource).toBe("sandbox_policy")
    expect(decision.approvalKind).toBe("sandbox_escalation")
    expect(decision.finalReason).toContain("Required sandbox backend is unavailable")
  })

  test("allows safe auto commands to fall back when failure policy permits fallback", () => {
    const decision = resolveExecutionDecision({
      securityDecision: "allow",
      securityReason: "No risky shell features detected.",
      riskLevel: "safe",
      policyDecision: evalResult("allow"),
      policy: policy("auto", "fallback"),
      capabilities: windowsNativeUnavailable,
      privilegeEscalation: false,
    })

    expect(decision.finalDecision).toBe("allow")
    expect(decision.policySource).toBe("shell_security")
    expect(decision.backendAvailability).toContain("windows_native:unavailable")
    expect(decision.sandboxEscalationReason).toBeUndefined()
  })

  test("blocks native backend without requested network enforcement under closed policy", () => {
    const decision = resolveExecutionDecision({
      securityDecision: "allow",
      securityReason: "No risky shell features detected.",
      riskLevel: "safe",
      policyDecision: evalResult("allow"),
      policy: policy("auto", "closed"),
      capabilities: windowsNativeFilesystemOnly,
      privilegeEscalation: false,
    })

    expect(decision.finalDecision).toBe("block")
    expect(decision.policySource).toBe("sandbox_policy")
    expect(decision.finalReason).toContain("cannot enforce none network policy")
  })

  test("confirms downgrade when native backend lacks requested network enforcement", () => {
    const decision = resolveExecutionDecision({
      securityDecision: "allow",
      securityReason: "No risky shell features detected.",
      riskLevel: "safe",
      policyDecision: evalResult("allow"),
      policy: policy("auto", "fallback"),
      capabilities: windowsNativeFilesystemOnly,
      privilegeEscalation: false,
    })

    expect(decision.finalDecision).toBe("confirm")
    expect(decision.approvalKind).toBe("sandbox_escalation")
    expect(decision.finalReason).toContain("confirmation required before downgrade")
  })

  test("confirms risky auto fallback when native backend is unavailable", () => {
    const decision = resolveExecutionDecision({
      securityDecision: "allow",
      securityReason: "No risky shell features detected.",
      riskLevel: "medium",
      policyDecision: evalResult("allow"),
      policy: policy("auto", "fallback"),
      capabilities: windowsNativeUnavailable,
      privilegeEscalation: false,
    })

    expect(decision.finalDecision).toBe("confirm")
    expect(decision.policySource).toBe("sandbox_policy")
    expect(decision.approvalKind).toBe("sandbox_escalation")
    expect(decision.finalReason).toContain("confirmation required before downgrade")
  })

  test("preserves exec-policy rule source when it is the strictest decision", () => {
    const decision = resolveExecutionDecision({
      securityDecision: "allow",
      securityReason: "No risky shell features detected.",
      riskLevel: "safe",
      policyDecision: evalResult("confirm", true),
      policy: policy("process", "fallback"),
      capabilities: processOnly,
      privilegeEscalation: false,
    })

    expect(decision.finalDecision).toBe("confirm")
    expect(decision.policySource).toBe("exec_policy")
    expect(decision.matchedRules).toEqual(["cmd"])
  })
})
