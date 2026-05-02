import { MessageV2 } from "@/session/message-v2"
import type { TaskRuntime } from "@/session/task-runtime"
import type { CoordinatorNode as CoordinatorNodeType } from "./schema"

// Coordinator task prompt helpers for template selection and review message text.
// This module only derives strings and template variables; it does not render templates or call models.

export function messageText(message: MessageV2.WithParts) {
  return message.parts
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
}

function promptLineValue(prompt: string, label: string) {
  return prompt
    .split("\n")
    .find((line) => line.startsWith(`${label}: `))
    ?.slice(label.length + 2)
}

export function promptTemplateRoleAndVariant(node: CoordinatorNodeType) {
  const roleAndVariant = node.prompt_template_id?.split("/") ?? []
  const role = roleAndVariant[0] || node.expert_role || node.role
  const templateRole = role === "checkpoint-reviewer" ? "reviewer" : role
  const forcedVariant = roleAndVariant.length > 1 ? roleAndVariant.slice(1).join("/") : undefined
  if (forcedVariant) return { role: templateRole, forceVariant: forcedVariant }
  if (templateRole === "reviser" && !node.prompt.includes("Target node:")) {
    return { role: templateRole, forceVariant: "no-target" }
  }
  if (templateRole === "verifier") return { role: templateRole, forceVariant: "shard" }
  if (templateRole === "reviewer" && node.prompt.includes("budget checkpoint")) {
    return { role: templateRole, forceVariant: "checkpoint" }
  }
  if (templateRole === "reducer" && node.prompt.includes("For project deep dives")) {
    return { role: templateRole, forceVariant: "project-deep-dive" }
  }
  return { role: templateRole, forceVariant: undefined }
}

export function promptTemplateVars(node: CoordinatorNodeType) {
  return {
    goal: promptLineValue(node.prompt, "Goal"),
    workflow: node.workflow ?? promptLineValue(node.prompt, "Workflow"),
    effort: promptLineValue(node.prompt, "Effort"),
    target_id: promptLineValue(node.prompt, "Target node"),
    kind: promptLineValue(node.prompt, "Revise kind"),
    checks_block: (node.assigned_scope.length ? node.assigned_scope : node.acceptance_checks)
      .map((item) => `- ${item}`)
      .join("\n"),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function buildTaskPrompt(record: TaskRuntime.TaskRecord, dependencies: TaskRuntime.TaskRecord[]) {
  const metadata = record.metadata ?? {}
  const promptText = typeof metadata.prompt === "string" ? metadata.prompt : record.description
  const role = typeof metadata.role === "string" ? `\n\nRole: ${metadata.role}` : ""
  const risk = typeof metadata.risk === "string" ? `\nRisk: ${metadata.risk}` : ""
  const output = typeof metadata.output_schema === "string" ? `\nOutput schema: ${metadata.output_schema}` : ""
  const workflow = typeof metadata.workflow === "string" ? `\nWorkflow: ${metadata.workflow}` : ""
  const effort = typeof metadata.effort === "string" ? `\nEffort: ${metadata.effort}` : ""
  const expert = typeof metadata.expert_id === "string" ? `\nExpert: ${metadata.expert_id}` : ""
  const memoryNamespace =
    typeof metadata.memory_namespace === "string" ? `\nMemory namespace: ${metadata.memory_namespace}` : ""
  const revisePolicy = typeof metadata.revise_policy === "string" ? `\nRevise policy: ${metadata.revise_policy}` : ""
  const longTask = isRecord(metadata.long_task) && metadata.long_task.is_long_task === true ? `\nLong task: true` : ""
  const todoTimeline =
    isRecord(metadata.todo_timeline) && Array.isArray(metadata.todo_timeline.todos)
      ? `\nTodo timeline:\n${metadata.todo_timeline.todos
          .map((item) =>
            isRecord(item) ? `- ${String(item.id)}: ${String(item.title)} [${String(item.status)}]` : undefined,
          )
          .filter((item): item is string => Boolean(item))
          .join("\n")}`
      : ""
  const parallelGroup =
    typeof metadata.parallel_group === "string" ? `\nParallel group: ${metadata.parallel_group}` : ""
  const assignedScope =
    Array.isArray(metadata.assigned_scope) && metadata.assigned_scope.length
      ? `\nAssigned scope:\n${metadata.assigned_scope.map((item) => `- ${String(item)}`).join("\n")}`
      : ""
  const excludedScope =
    Array.isArray(metadata.excluded_scope) && metadata.excluded_scope.length
      ? `\nExcluded scope:\n${metadata.excluded_scope.map((item) => `- ${String(item)}`).join("\n")}`
      : ""
  const dependencySummaries = dependencies.length
    ? `\n\nCompleted dependency handoff:\n${dependencies.map((item) => `- ${item.description}: ${item.result_summary ?? item.error_summary ?? item.status}`).join("\n")}`
    : ""
  const roleContract =
    metadata.role === "reducer"
      ? "\n\nReducer contract: output compact_synthesis, conflicts, recommended_next_nodes, evidence_coverage, and confidence. Do not pass through full raw transcripts."
      : metadata.role === "implementer"
        ? "\n\nImplementer contract: use reducer/checkpoint synthesis as primary context; return changed_scope, rollback_notes, local_verification, risks, and confidence."
        : metadata.role === "verifier"
          ? "\n\nVerifier contract: verify only your assigned dimension; return evidence, command summaries when available, residual_risk, and confidence."
          : metadata.role === "reviewer"
            ? "\n\nReviewer contract: consume final artifact, verifier evidence, and checkpoint memory; return verdict, required_fixes, evidence_for, evidence_against, and residual_risks."
            : metadata.role === "researcher"
              ? "\n\nResearcher contract: stay inside assigned_scope, avoid excluded_scope, and return evidence, confidence, unknowns, and recommended_next_step."
              : ""
  const checks = record.acceptance_checks.length
    ? `\n\nAcceptance checks:\n${record.acceptance_checks.map((item: string) => `- ${item}`).join("\n")}`
    : ""
  // Wave 7: acceptable_failure spec. When the planner attached one, surface
  // it as a legitimate stop affordance so the agent doesn't reward-hack the
  // impossible-spec case (Emotion paper §1.3 case B).
  const acceptableFailure =
    isRecord(metadata.acceptable_failure) &&
    Array.isArray(metadata.acceptable_failure.conditions) &&
    metadata.acceptable_failure.conditions.length > 0
      ? `\n\nAcceptable-failure conditions (use task_give_up with reason="${
          typeof metadata.acceptable_failure.on_match === "string" ? metadata.acceptable_failure.on_match : "give_up"
        }" if any holds — these are expected outcomes, not failures):\n${metadata.acceptable_failure.conditions
          .map((item) => `- ${String(item)}`)
          .join("\n")}`
      : ""
  return `${promptText}${role}${workflow}${effort}${expert}${risk}${output}${memoryNamespace}${revisePolicy}${longTask}${todoTimeline}${parallelGroup}${assignedScope}${excludedScope}${dependencySummaries}${roleContract}${checks}${acceptableFailure}\n\nBefore finalizing, list assumptions, check evidence support, identify missing context, and choose proceed, retry, ask_user, or handoff. Return a concise structured result with summary, evidence, assumptions, missing_context, risks, confidence, and next_step.`
}
