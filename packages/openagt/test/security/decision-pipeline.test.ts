import { describe, expect, test } from "bun:test"
import { resolveExecutionDecision, strictestDecision } from "../../src/security/decision-pipeline"
import type { EvaluationResult } from "../../src/security/exec-policy"
import type { SandboxBackendPreference, SandboxBackendStatus, SandboxFailurePolicy } from "../../src/sandbox/types"

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
) => ({
  sandbox: {
    enabled: true,
    backend,
    failure_policy: failurePolicy,
    report_only: false,
    broker_idle_ttl_ms: 300_000,
  },
  backend_preference: backend,
  needs_network_permission: network,
})

const processOnly: SandboxBackendStatus[] = [{ name: "process", available: true }]

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
