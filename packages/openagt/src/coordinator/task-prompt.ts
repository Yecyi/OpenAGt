import { MessageV2 } from "@/session/message-v2"
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
