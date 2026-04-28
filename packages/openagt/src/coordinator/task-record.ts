import { ModelID, ProviderID } from "@/provider/schema"
import { TaskRuntime } from "@/session/task-runtime"

// Task record metadata helpers shared by coordinator planning and review code.
// This module only reads task metadata; it does not update task state.

export function nodeIDForTask(task: TaskRuntime.TaskRecord) {
  return typeof task.metadata?.coordinator_node_id === "string" ? task.metadata.coordinator_node_id : undefined
}

export function mpacrCriticTimeoutMs(metadata: Record<string, unknown> | undefined) {
  if (typeof metadata?.mpacr_per_critic_timeout_ms === "number") return metadata.mpacr_per_critic_timeout_ms
  const profile = metadata?.effort_profile
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return 180_000
  const value = (profile as Record<string, unknown>).mpacr_per_critic_timeout_ms
  return typeof value === "number" ? value : 180_000
}

export function taskModel(metadata: Record<string, unknown>) {
  const value = metadata.model
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const model = value as Record<string, unknown>
  if (typeof model.providerID !== "string" || typeof model.modelID !== "string") return undefined
  return {
    providerID: ProviderID.make(model.providerID),
    modelID: ModelID.make(model.modelID),
  }
}

export function taskVariant(metadata: Record<string, unknown>) {
  const value = metadata.model
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const model = value as Record<string, unknown>
  return typeof model.variant === "string" ? model.variant : undefined
}
