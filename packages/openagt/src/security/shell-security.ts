import { Context, Effect, Layer } from "effect"
import { Shell } from "@/shell/shell"
import { commandClassifier } from "./command-classifier"
import { WrapperStripper } from "./wrapper-stripper"
import type {
  SandboxBackendPreference,
  SandboxEnforcement,
  SandboxFilesystemPolicy,
  SandboxNetworkPolicy,
} from "@/sandbox/types"

export type ShellFamily = "powershell" | "posix" | "cmd"
export type ShellDecision = "allow" | "confirm" | "block"
export type ShellRiskLevel = "safe" | "low" | "medium" | "high"
export type ReviewMode = "disabled"
export type ReviewStatus = "not_requested"
export type ReviewAPIVersion = 1

export type ShellFinding = {
  id: string
  category:
    | "parse_integrity"
    | "injection"
    | "obfuscation"
    | "interpreter_escalation"
    | "filesystem_destruction"
    | "privilege_escalation"
    | "network_exfiltration"
    | "sandbox_escape"
    | "environment_hijack"
  severity: "low" | "medium" | "high"
  confidence: "deterministic"
  evidence: string
  misparse_sensitive: boolean
  shell_scope: "all" | "posix" | "powershell" | "cmd"
}

export type ShellReviewCandidate = {
  id: string
  reason: string
}

export type ShellSandboxRequirement = {
  enforcement: SandboxEnforcement
  backend_preference: SandboxBackendPreference
  filesystem_policy: SandboxFilesystemPolicy
  network_policy: SandboxNetworkPolicy
  allowed_paths: string[]
  writable_paths: string[]
}

export type ShellFeatures = {
  wrappers: string[]
  envAssignments: string[]
  hasCommandSubstitution: boolean
  hasInterpreterExecution: boolean
  hasRedirection: boolean
  hasPipeline: boolean
  hasMultiline: boolean
  hasObfuscationSignals: boolean
  hasDangerousPathTargets: boolean
}

export type ShellSecurityResult = {
  command: string
  normalized_command: string
  sanitized_command: string
  shell_family: ShellFamily
  features: ShellFeatures
  findings: ShellFinding[]
  risk_level: ShellRiskLevel
  decision: ShellDecision
  sandbox_requirement: ShellSandboxRequirement
  explanation: string
  review_candidates: ShellReviewCandidate[]
  review_api_version: ReviewAPIVersion
  review_mode: ReviewMode
  review_status: ReviewStatus
}

export type ShellPermissionMetadata = {
  command: string
  normalizedCommand: string
  description: string
  shellFamily: ShellFamily
  riskLevel: ShellRiskLevel
  decision: ShellDecision
  findings: ShellFinding[]
  workdir: string
  backendPreference: SandboxBackendPreference
  enforcement: SandboxEnforcement
  filesystemPolicy: SandboxFilesystemPolicy
  networkPolicy: SandboxNetworkPolicy
  allowedPathsSummary: string[]
  backendAvailability: string
  externalPaths: string[]
  reason: string
  reviewApiVersion: ReviewAPIVersion
  reviewMode: ReviewMode
  reviewStatus: ReviewStatus
}

function mapShellFamily(shell: string): ShellFamily {
  const name = Shell.name(shell)
  if (name === "powershell" || name === "pwsh") return "powershell"
  if (name === "cmd") return "cmd"
  return "posix"
}

function findingCategory(message: string): ShellFinding["category"] {
  const lower = message.toLowerCase()
  if (lower.includes("obfus")) return "obfuscation"
  if (lower.includes("control characters") || lower.includes("unicode whitespace") || lower.includes("newline"))
    return "parse_integrity"
  if (lower.includes("dangerous environment variable") || lower.includes("dangerous variable"))
    return "environment_hijack"
  if (lower.includes("command substitution") || lower.includes("pipe") || lower.includes("interpreter"))
    return "interpreter_escalation"
  if (lower.includes("zsh dangerous") || lower.includes("shell operator")) return "sandbox_escape"
  if (lower.includes("ifs")) return "injection"
  if (lower.includes("proc")) return "network_exfiltration"
  return "injection"
}

function shouldBlock(input: { command: string; risk: ShellRiskLevel; warnings: string[] }) {
  const lower = input.command.toLowerCase()
  if (/(curl|wget).*\|.*(sh|bash|zsh|pwsh|powershell|cmd)(\s|$)/i.test(lower)) return true
  if (input.risk !== "high") return false
  if (/(^|[\s;&|])eval[\s(]/i.test(lower)) return true
  if (/rm\s+-rf\s+(\/|\*|~)/i.test(lower)) return true
  if (/mkfs|format\s+[a-z]:|diskpart|fdisk|parted/i.test(lower)) return true
  return input.warnings.some((item) => {
    const warning = item.toLowerCase()
    return (
      warning.includes("control characters") ||
      warning.includes("newline") ||
      warning.includes("dangerous environment variable")
    )
  })
}

function buildFeatures(command: string, wrappers: string[], sanitized: string, warnings: string[]): ShellFeatures {
  return {
    wrappers,
    envAssignments: Array.from(command.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)=/g)).map((match) => match[1]!),
    hasCommandSubstitution: /\$\(|`|\$\{/.test(sanitized),
    hasInterpreterExecution: /\b(python|python3|node|bun|deno|ruby|perl|php|bash|sh|zsh|pwsh|powershell)\b/i.test(
      sanitized,
    ),
    hasRedirection: /(^|[^<])>(>|)?|<</.test(sanitized),
    hasPipeline: /\|/.test(sanitized),
    hasMultiline: /\r|\n/.test(command),
    hasObfuscationSignals: warnings.some((item) => item.toLowerCase().includes("obfus")),
    hasDangerousPathTargets: /(^|[\s;&|])(rm|remove-item)\b/i.test(sanitized),
  }
}

function buildFindings(input: { warnings: string[]; matchedPatterns: string[]; risk: ShellRiskLevel }): ShellFinding[] {
  return input.warnings.map((warning, index) => ({
    id: input.matchedPatterns[index] ?? `shell_rule_${index + 1}`,
    category: findingCategory(warning),
    severity: input.risk === "high" ? "high" : input.risk === "medium" ? "medium" : "low",
    confidence: "deterministic",
    evidence: warning,
    misparse_sensitive: warning.toLowerCase().includes("incomplete") || warning.toLowerCase().includes("newline"),
    shell_scope: "all",
  }))
}

function decisionFor(input: { risk: ShellRiskLevel; command: string; warnings: string[] }): ShellDecision {
  if (shouldBlock(input)) return "block"
  if (input.risk === "medium" || input.risk === "high") return "confirm"
  return "allow"
}

function reviewCandidates(result: { findings: ShellFinding[]; decision: ShellDecision }): ShellReviewCandidate[] {
  if (result.decision === "block") return []
  return result.findings
    .filter((item) => item.misparse_sensitive || item.severity === "high")
    .map((item) => ({
      id: item.id,
      reason: item.evidence,
    }))
}

export type AnalyzeInput = {
  command: string
  shell: string
  cwd: string
}

export interface Interface {
  readonly analyze: (input: AnalyzeInput) => Effect.Effect<ShellSecurityResult>
  readonly createPermissionMetadata: (input: {
    result: ShellSecurityResult
    description: string
    workdir: string
    externalPaths: string[]
  }) => ShellPermissionMetadata
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShellSecurity") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const wrapperStripper = new WrapperStripper()

    const analyze = Effect.fn("ShellSecurity.analyze")(function* (input: AnalyzeInput) {
      const shell_family = mapShellFamily(input.shell)

      // Classify original command first
      const originalClassification = commandClassifier.classify(input.command)

      // Strip wrappers and classify stripped command
      const stripped = wrapperStripper.stripAll(input.command)
      const strippedClassification = commandClassifier.classify(stripped)

      // Take max risk level between original and stripped
      const riskLevels: Record<string, number> = { safe: 0, low: 1, medium: 2, high: 3 }
      const originalRisk = riskLevels[originalClassification.riskLevel] ?? 0
      const strippedRisk = riskLevels[strippedClassification.riskLevel] ?? 0
      const finalRisk = originalRisk >= strippedRisk
        ? originalClassification.riskLevel
        : strippedClassification.riskLevel
      const finalWarnings = [...originalClassification.warnings, ...strippedClassification.warnings]
      const finalPatterns = [...originalClassification.matchedPatterns, ...strippedClassification.matchedPatterns]

      // Check if becomes dangerous after strip
      const becomesDangerous = wrapperStripper.becomesDangerousAfterStrip(input.command)
      const finalRiskForDecision = becomesDangerous ? "high" : finalRisk

      const features = buildFeatures(input.command, wrapperStripper.getWrapperNames(input.command), stripped, finalWarnings)
      const findings = buildFindings({
        warnings: finalWarnings,
        matchedPatterns: finalPatterns,
        risk: finalRiskForDecision,
      })
      const decision = decisionFor({
        risk: finalRiskForDecision,
        command: stripped,
        warnings: finalWarnings,
      })
      const sandbox_requirement: ShellSandboxRequirement = {
        enforcement: decision === "confirm" ? "required" : "advisory",
        backend_preference: "auto",
        filesystem_policy: "workspace_write",
        network_policy: "none",
        allowed_paths: [input.cwd],
        writable_paths: [input.cwd],
      }

      const result: ShellSecurityResult = {
        command: input.command,
        normalized_command: stripped,
        sanitized_command: stripped,
        shell_family,
        features,
        findings,
        risk_level: finalRiskForDecision,
        decision,
        sandbox_requirement,
        explanation:
          finalWarnings[0] ??
          (decision === "allow" ? "No risky shell features detected." : "Shell command requires manual review."),
        review_candidates: reviewCandidates({ findings, decision }),
        review_api_version: 1,
        review_mode: "disabled",
        review_status: "not_requested",
      }

      return result
    })

    const createPermissionMetadata = (input: {
      result: ShellSecurityResult
      description: string
      workdir: string
      externalPaths: string[]
    }): ShellPermissionMetadata => ({
      command: input.result.command,
      normalizedCommand: input.result.normalized_command,
      description: input.description,
      shellFamily: input.result.shell_family,
      riskLevel: input.result.risk_level,
      decision: input.result.decision,
      findings: input.result.findings,
      workdir: input.workdir,
      backendPreference: input.result.sandbox_requirement.backend_preference,
      enforcement: input.result.sandbox_requirement.enforcement,
      filesystemPolicy: input.result.sandbox_requirement.filesystem_policy,
      networkPolicy: input.result.sandbox_requirement.network_policy,
      allowedPathsSummary: input.result.sandbox_requirement.allowed_paths,
      backendAvailability: "pending",
      externalPaths: input.externalPaths,
      reason: input.result.explanation,
      reviewApiVersion: input.result.review_api_version,
      reviewMode: input.result.review_mode,
      reviewStatus: input.result.review_status,
    })

    return Service.of({
      analyze,
      createPermissionMetadata,
    })
  }),
)

export const defaultLayer = layer

export * as ShellSecurity from "./shell-security"
