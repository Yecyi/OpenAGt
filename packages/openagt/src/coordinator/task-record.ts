import { TaskRuntime } from "@/session/task-runtime"

// Task record metadata helpers shared by coordinator planning and review code.
// This module only reads task metadata; it does not update task state.

export function nodeIDForTask(task: TaskRuntime.TaskRecord) {
  return typeof task.metadata?.coordinator_node_id === "string" ? task.metadata.coordinator_node_id : undefined
}
