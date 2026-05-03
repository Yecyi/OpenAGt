// Coordinator intent classification and public intent profile construction.
// This file classifies goals only; it does not generate plan nodes or run coordinator tasks.

import { classifyGoal, isProjectDeepDiveGoal } from "@/agent/task-classifier"
import { detectDomain } from "@/personal/three-layer"
import { IntentProfile, type IntentProfile as IntentProfileType, type TaskType as TaskTypeType } from "./schema"

function taskTypeForGoal(goal: string): TaskTypeType {
  return classifyGoal(goal).workflow
}

function riskForGoal(goal: string, _taskType: TaskTypeType) {
  return classifyGoal(goal).risk_level
}

function successCriteria(taskType: TaskTypeType) {
  if (taskType === "coding")
    return [
      "Relevant context is gathered",
      "Requested changes are implemented",
      "Acceptance checks are verified",
      "Independent review is completed",
    ]
  if (taskType === "debugging")
    return [
      "Failure context is reproduced or explained",
      "Root cause is identified",
      "Minimal fix path is applied",
      "Verification passes",
    ]
  if (taskType === "review")
    return ["Findings are grounded in source references", "Risks are prioritized", "Residual test gaps are reported"]
  if (taskType === "research")
    return ["Sources and local context are synthesized", "Actionable conclusions are written", "Claims are reviewed"]
  if (taskType === "writing")
    return ["Audience and purpose are identified", "Draft is produced", "Style and factuality are reviewed"]
  if (taskType === "data-analysis") return ["Data shape is profiled", "Analysis is performed", "Statistics and anomalies are verified"]
  if (taskType === "planning")
    return ["Goal is decomposed", "Constraints and alternatives are checked", "Risks are reviewed"]
  if (taskType === "personal-admin")
    return ["Work items are classified", "Priorities and schedule are proposed", "Privacy risks are reviewed"]
  if (taskType === "documentation")
    return ["Context is gathered", "Document is updated or produced", "Output is reviewed for accuracy"]
  if (taskType === "environment-audit")
    return ["Toolchain state is inspected", "Real blockers are identified", "Verification commands are reported"]
  if (taskType === "automation")
    return [
      "Repeatable workflow is identified",
      "Automation plan is generated",
      "Risk and trigger conditions are verified",
    ]
  if (taskType === "file-data-organization") return ["Files or data are inventoried", "Changes are scoped", "Result is verified"]
  return ["Goal is clarified enough to execute", "Work is completed", "Result is summarized"]
}

function expectedOutput(taskType: TaskTypeType) {
  if (taskType === "coding") return "code changes, verification results, and review notes"
  if (taskType === "debugging") return "root cause, fix, and verification evidence"
  if (taskType === "review") return "prioritized findings with file references and residual risks"
  if (taskType === "research") return "research report with actionable synthesis"
  if (taskType === "writing") return "structured written draft with style and factuality review"
  if (taskType === "data-analysis") return "analysis summary with data caveats, checks, and anomalies"
  if (taskType === "planning") return "execution plan with constraints, alternatives, and risks"
  if (taskType === "personal-admin") return "prioritized personal admin actions with privacy review"
  if (taskType === "documentation") return "updated documentation or a written artifact"
  if (taskType === "environment-audit") return "environment diagnosis with blockers and next actions"
  if (taskType === "automation") return "automation plan or configured automation"
  if (taskType === "file-data-organization") return "organized files/data and a change summary"
  return "completed work summary with evidence"
}

function permissionExpectations(taskType: TaskTypeType, riskLevel: IntentProfileType["risk_level"]) {
  const base =
    taskType === "research" || taskType === "review"
      ? ["read workspace context"]
      : ["read workspace context", "run verification commands"]
  const write =
    taskType === "coding" ||
    taskType === "debugging" ||
    taskType === "documentation" ||
    taskType === "file-data-organization" ||
    taskType === "writing" ||
    taskType === "data-analysis"
      ? ["write scoped workspace files"]
      : []
  const approval = riskLevel === "high" ? ["request approval before high-risk actions"] : []
  return [...base, ...write, ...approval]
}

export function settleIntentProfile(input: { goal: string }) {
  const classification = classifyGoal(input.goal)
  const task_type = taskTypeForGoal(input.goal)
  const risk_level = riskForGoal(input.goal, task_type)
  const needs_user_clarification = input.goal.trim().length < 12
  const projectDeepDive = isProjectDeepDiveGoal(input.goal)
  return IntentProfile.parse({
    goal: input.goal,
    task_type,
    success_criteria: successCriteria(task_type),
    risk_level,
    needs_user_clarification,
    clarification_questions: needs_user_clarification ? ["What concrete output should this task produce?"] : [],
    workflow: task_type,
    workflow_confidence: projectDeepDive ? "high" : classification.confidence,
    secondary_workflows: [],
    expected_output: expectedOutput(task_type),
    permission_expectations: permissionExpectations(task_type, risk_level),
    domain: detectDomain(input.goal),
  })
}
