import type { RiskLevel, TaskType } from "@/coordinator/schema"
import { IntentDictionary, hasAnyRawTerm, hasAnyTerm } from "./intent-dictionary"

export type GoalClassification = {
  workflow: TaskType
  risk_level: RiskLevel
  broad_task: boolean
  confidence: "low" | "medium" | "high"
  reasons: string[]
  matched_terms: string[]
  fallback_used: boolean
}

function matches(goal: string, normalized: string, terms: { en: readonly string[]; zh: readonly string[] }) {
  return [
    ...terms.en.filter((item) => normalized.includes(item.toLowerCase())),
    ...terms.zh.filter((item) => goal.includes(item)),
  ]
}

export function classifyGoal(goal: string): GoalClassification {
  const normalized = goal.toLowerCase()
  const explicitProject = matches(goal, normalized, IntentDictionary.explicitProjectPhrases)
  const broadModifiers = matches(goal, normalized, IntentDictionary.broadModifiers)
  const projectTargets = matches(goal, normalized, IntentDictionary.projectTargets)
  const technicalTargets = matches(goal, normalized, IntentDictionary.technicalTargets)
  const broad_task =
    explicitProject.length > 0 ||
    (broadModifiers.length > 0 && (projectTargets.length > 0 || technicalTargets.length > 0)) ||
    (projectTargets.length > 0 && technicalTargets.length > 0 && broadModifiers.length > 0)
  const workflowMatch =
    broad_task && (projectTargets.length > 0 || technicalTargets.length > 0)
      ? {
          workflow: "research" as const,
          terms: [...explicitProject, ...broadModifiers, ...projectTargets, ...technicalTargets],
        }
      : IntentDictionary.workflow
          .map((item) => ({
            workflow: item.workflow,
            terms: [
              ...item.en.filter((term) => normalized.includes(term.toLowerCase())),
              ...item.zh.filter((term) => goal.includes(term)),
            ],
          }))
          .find((item) => item.terms.length > 0)
  const workflow = workflowMatch?.workflow ?? "general-operations"
  const riskMatches = [
    ...IntentDictionary.risk.high.en.filter((item) => normalized.includes(item.toLowerCase())),
    ...IntentDictionary.risk.high.zh.filter((item) => goal.includes(item)),
  ]
  const risk_level =
    riskMatches.length > 0
      ? "high"
      : workflow === "coding" || workflow === "debugging" || workflow === "automation" || workflow === "environment-audit"
        ? "medium"
        : "low"
  const matched_terms = [...(workflowMatch?.terms ?? []), ...riskMatches]
  const fallback_used = !workflowMatch
  const confidence =
    broad_task || riskMatches.length > 0 || matched_terms.length >= 2
      ? "high"
      : fallback_used || goal.trim().length < 12
        ? "low"
        : "medium"
  return {
    workflow,
    risk_level,
    broad_task,
    confidence,
    reasons: [
      broad_task ? "broad project/deep-dive signals matched" : undefined,
      workflowMatch ? `workflow matched: ${workflow}` : "no workflow dictionary match; using general-operations",
      riskMatches.length > 0 ? "high-risk terms matched" : undefined,
    ].filter((item): item is string => Boolean(item)),
    matched_terms,
    fallback_used,
  }
}

export function isProjectDeepDiveGoal(goal: string) {
  const normalized = goal.toLowerCase()
  return (
    classifyGoal(goal).broad_task &&
    (hasAnyTerm(normalized, IntentDictionary.projectTargets.en) ||
      hasAnyRawTerm(goal, IntentDictionary.projectTargets.zh) ||
      hasAnyTerm(normalized, ["project architecture", "project structure", "repository structure"]) ||
      hasAnyRawTerm(goal, ["项目架构", "项目结构", "仓库结构"]))
  )
}
