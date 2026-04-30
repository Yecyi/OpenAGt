import { classifyGoal, isBroadAgentTask } from "@/agent/task-classifier"
import {
  LongTaskProfile,
  type EffortLevel,
  type IntentProfile,
  type LongTaskProfile as LongTaskProfileType,
} from "./schema"
import type { WorkspaceSignals } from "./workspace-signals"

type Signal = {
  label: string
  weight: number
  active: boolean
}

const quickTerms = [
  "quick",
  "quickly",
  "simple",
  "small",
  "minor",
  "tiny",
  "just",
  "only",
  "typo",
  "one file",
  "single file",
  "minimal",
  "brief",
] as const

const expansiveTerms = [
  "complete",
  "comprehensive",
  "productionize",
  "stable",
  "hardening",
  "release",
  "end to end",
  "e2e",
  "low intervention",
  "autonomous",
  "multi-stage",
  "full project",
  "entire project",
  "whole project",
] as const

function hasTerm(goal: string, terms: readonly string[]) {
  const normalized = goal.toLowerCase()
  return terms.some((item) => normalized.includes(item))
}

function activeLabels(signals: Signal[]) {
  return signals.filter((item) => item.active).map((item) => item.label)
}

function signalScore(signals: Signal[]) {
  return signals.filter((item) => item.active).reduce((acc, item) => acc + item.weight, 0)
}

export function longTaskProfileForDecision(input: {
  goal: string
  intent: IntentProfile
  effort: EffortLevel
  nodeCount: number
  workspaceSignals?: WorkspaceSignals
  decisionStage?: LongTaskProfileType["decision_stage"]
}) {
  const goalClassification = classifyGoal(input.goal)
  const tokenEstimate = Math.ceil(input.goal.length / 4)
  const outputDimensions = input.intent.success_criteria.length + (input.goal.match(/\n|\d\.|;|,/g)?.length ?? 0)
  const workspaceFileCount = input.workspaceSignals?.file_count ?? 0
  const workspacePackageCount = input.workspaceSignals?.package_count ?? 0
  const workspaceLanguageCount = input.workspaceSignals?.language_count ?? 0
  const workspaceScore =
    workspaceFileCount >= 1_000 ? 3 : workspaceFileCount >= 300 ? 2 : workspaceFileCount >= 100 ? 1 : 0
  const positive = [
    { label: "broad or deep-dive goal", weight: 3, active: isBroadAgentTask(input.goal) },
    {
      label: `${input.effort} effort selected`,
      weight: input.effort === "deep" ? 2 : input.effort === "high" ? 1 : 0,
      active: input.effort === "high" || input.effort === "deep",
    },
    {
      label: `coordinator plan has ${input.nodeCount} nodes`,
      weight: input.nodeCount >= 12 ? 3 : input.nodeCount >= 8 ? 2 : input.nodeCount >= 5 ? 1 : 0,
      active: input.nodeCount >= 5,
    },
    {
      label: `prompt estimate is ${tokenEstimate} tokens`,
      weight: tokenEstimate >= 300 ? 2 : tokenEstimate >= 120 ? 1 : 0,
      active: tokenEstimate >= 120,
    },
    {
      label: `goal has ${outputDimensions} output dimensions`,
      weight: outputDimensions >= 8 ? 2 : outputDimensions >= 5 ? 1 : 0,
      active: outputDimensions >= 5,
    },
    { label: "expansive outcome terms matched", weight: 2, active: hasTerm(input.goal, expansiveTerms) },
    {
      label: `workflow is ${input.intent.workflow}`,
      weight: ["coding", "debugging", "research", "documentation", "environment-audit", "automation"].includes(
        input.intent.workflow,
      )
        ? 1
        : 0,
      active: ["coding", "debugging", "research", "documentation", "environment-audit", "automation"].includes(
        input.intent.workflow,
      ),
    },
    { label: "high risk intent", weight: 1, active: input.intent.risk_level === "high" },
    { label: "low workflow confidence", weight: 1, active: input.intent.workflow_confidence === "low" },
    {
      label: `workspace has at least ${workspaceFileCount} scanned files`,
      weight: workspaceScore,
      active: workspaceScore > 0,
    },
    {
      label: `workspace has ${workspacePackageCount} package or lockfile markers`,
      weight: workspacePackageCount >= 6 ? 2 : workspacePackageCount >= 2 ? 1 : 0,
      active: workspacePackageCount >= 2,
    },
    {
      label: `workspace has ${workspaceLanguageCount} file extension families`,
      weight: workspaceLanguageCount >= 4 ? 1 : 0,
      active: workspaceLanguageCount >= 4,
    },
    { label: "multiple secondary workflows", weight: 1, active: input.intent.secondary_workflows.length >= 2 },
  ] satisfies Signal[]
  const negative = [
    { label: "quick or minimal task wording", weight: 4, active: hasTerm(input.goal, quickTerms) },
    {
      label: "short goal with clear workflow",
      weight: 2,
      active: tokenEstimate < 20 && input.intent.workflow_confidence === "high",
    },
    { label: "small coordinator plan", weight: 2, active: input.nodeCount <= 3 },
    {
      label: "read-only single-artifact task",
      weight: 1,
      active: input.intent.permission_expectations.every((item) => !item.includes("write")) && outputDimensions <= 4,
    },
  ] satisfies Signal[]
  const positiveScore = signalScore(positive)
  const negativeScore = signalScore(negative)
  const score = Math.max(0, positiveScore - negativeScore)
  const classification =
    score >= 10 && negativeScore <= 2 ? "epic" : score >= 7 ? "long" : score >= 4 ? "medium" : "short"
  const is_long_task = classification === "long" || classification === "epic"
  const task_size =
    classification === "epic"
      ? "huge"
      : classification === "long"
        ? "large"
        : classification === "medium"
          ? "medium"
          : "small"
  const confidence =
    Math.abs(positiveScore - negativeScore) >= 5 ||
    activeLabels(positive).length >= 5 ||
    activeLabels(negative).length >= 2
      ? "high"
      : Math.abs(positiveScore - negativeScore) >= 2
        ? "medium"
        : "low"
  const needs_user_confirmation =
    input.intent.risk_level === "high" &&
    (classification === "long" || classification === "epic") &&
    confidence !== "high"
  const execution_model = classification === "epic" ? "epic" : is_long_task ? "long-task" : "short-task"
  return LongTaskProfile.parse({
    is_long_task,
    task_size,
    timeline_required: is_long_task,
    execution_model,
    classification,
    confidence,
    trigger_score: score,
    decision_stage: input.decisionStage ?? "post-plan",
    positive_signals: [...activeLabels(positive), ...(input.workspaceSignals?.reasons ?? [])],
    negative_signals: activeLabels(negative),
    needs_user_confirmation,
    auto_upgrade_allowed: !hasTerm(input.goal, quickTerms),
    auto_downgrade_allowed: true,
    active_milestone_limit: execution_model === "epic" ? 2 : 1,
    milestone_count: execution_model === "epic" ? 6 : execution_model === "long-task" ? 5 : 0,
    reasons: [
      ...activeLabels(positive),
      ...activeLabels(negative).map((item) => `negative: ${item}`),
      ...goalClassification.reasons,
    ],
  })
}
