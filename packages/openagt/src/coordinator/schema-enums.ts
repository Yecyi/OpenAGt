import z from "zod"

export const NodePriority = z.enum(["high", "normal", "low"])
export type NodePriority = z.infer<typeof NodePriority>

export const TaskOrigin = z.enum(["user", "coordinator", "scheduler", "gateway"])
export type TaskOrigin = z.infer<typeof TaskOrigin>

export const TaskType = z.enum([
  "coding",
  "review",
  "debugging",
  "research",
  "writing",
  "data-analysis",
  "planning",
  "personal-admin",
  "documentation",
  "environment-audit",
  "automation",
  "file-data-organization",
  "general-operations",
])
export type TaskType = z.infer<typeof TaskType>

export const RiskLevel = z.enum(["low", "medium", "high"])
export type RiskLevel = z.infer<typeof RiskLevel>

export const CoordinatorMode = z.enum(["manual", "assisted", "autonomous"])
export type CoordinatorMode = z.infer<typeof CoordinatorMode>

export const CoordinatorParallelMode = z.enum(["off", "safe", "aggressive"])
export type CoordinatorParallelMode = z.infer<typeof CoordinatorParallelMode>

export const EffortLevel = z.enum(["low", "medium", "high", "deep"])
export type EffortLevel = z.infer<typeof EffortLevel>

export const ConfidenceLevel = z.enum(["low", "medium", "high"])
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>

export const TaskSize = z.enum(["small", "medium", "large", "huge"])
export type TaskSize = z.infer<typeof TaskSize>

export const BudgetScale = z.enum(["small", "normal", "large", "max"])
export type BudgetScale = z.infer<typeof BudgetScale>

export const AutoContinuePolicy = z.enum(["never", "checkpoint", "safe"])
export type AutoContinuePolicy = z.infer<typeof AutoContinuePolicy>

// Wave 5: how much personal memory a CoordinatorNode's session may see.
// Default "full" preserves existing behavior. "facts_only" filters memory
// queries to kind: ["fact"] so the subagent grounds in cross-session
// empirical claims but not in user preferences (devil's-advocate / red-team
// reviewers; sycophancy mitigation per ELEPHANT). "blind" excludes personal
// memory entirely for pure-adversary roles where any context bleed is
// undesirable.
export const PersonalMemoryAccess = z.enum(["full", "facts_only", "blind"])
export type PersonalMemoryAccess = z.infer<typeof PersonalMemoryAccess>

export const RevisePolicy = z.enum(["none", "critical_only", "all_artifacts"])
export type RevisePolicy = z.infer<typeof RevisePolicy>

export const ReviseKind = z.enum([
  "plan_revise",
  "input_revise",
  "output_revise",
  "handoff_revise",
  "reducer_revise",
  "verifier_revise",
  "debugger_revise",
  "final_revise",
  // MPACR (Multi-Perspective Adversarial Critical Review) stages.
  "steel_man",
  "red_team",
  "defense",
  "synthesis",
  "calibration",
])
export type ReviseKind = z.infer<typeof ReviseKind>

export const CoordinatorNodeRole = z.enum([
  "coordinator",
  "planner",
  "researcher",
  "reducer",
  "implementer",
  "verifier",
  "reviewer",
  "debugger",
  "reviser",
  "writer",
  "analyst",
  "style-editor",
  "factuality-checker",
  "citation-auditor",
  "contradiction-checker",
  "constraint-checker",
  "alternative-planner",
  "risk-reviewer",
  "inbox-classifier",
  "priority-sorter",
  "scheduler",
  "privacy-reviewer",
  "follow-up-planner",
  "trigger-designer",
  "dry-run-verifier",
  "rollback-planner",
  "doc-researcher",
  "structure-writer",
  "environment-auditor",
  "blocker-classifier",
  "remediation-planner",
  "inventory-agent",
  "organizer",
  "safety-verifier",
  "executor",
  "memory-curator",
  "automation-planner",
  // MPACR (Multi-Perspective Adversarial Critical Review) roles.
  "steel-manner",
  "red-team-critic",
  "defender",
  "synth-reviser",
  "calibrator",
])
export type CoordinatorNodeRole = z.infer<typeof CoordinatorNodeRole>

export const CoordinatorOutputSchema = z.enum([
  "plan",
  "research",
  "implementation",
  "verification",
  "review",
  "revise",
  "debug",
  "document",
  "analysis",
  "outline",
  "draft",
  "environment-diagnosis",
  "automation-plan",
  "organization-plan",
  "memory",
  "research-synthesis",
  "summary",
])
export type CoordinatorOutputSchema = z.infer<typeof CoordinatorOutputSchema>
