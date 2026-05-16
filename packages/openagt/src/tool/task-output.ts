import type { SessionID } from "../session/schema"
import type { MessageV2 } from "../session/message-v2"
import type { TaskRecord } from "../session/task-runtime"

export type TaskMetadata = {
  sessionId: SessionID
  model: {
    modelID: string
    providerID: string
  }
  taskId?: SessionID
  status?: "pending" | "running" | "completed" | "partial" | "failed" | "cancelled"
  groupId?: string
  error?: string
  retryable?: boolean
  partial?: boolean
  limitReason?: string
  partialSummary?: string
  resultText?: string
  remainingScope?: string[]
  gaveUp?: boolean
  giveUpReason?: string
  inboxId?: string
  recommendNext?: string
}

interface TaskParams {
  description: string
  prompt: string
  group_id?: string
  acceptance_checks?: string[]
  read_scope?: string[]
  write_scope?: string[]
  return_mode?: "id" | "summary"
}

interface TaskTarget {
  sessionId: SessionID
  model: { modelID: string; providerID: string }
}

export interface TaskOutput {
  title: string
  metadata: TaskMetadata
  output: string
}

export type TaskGiveUpOutcome = {
  reason: string
  output: string
  partialResult?: string
  recommendNext?: string
  inboxId?: string
}

function stringValue(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

export function assistantText(message: MessageV2.WithParts) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()
}

export function storedTaskResult(record: TaskRecord) {
  const resultText =
    typeof record.metadata?.result_text === "string" && record.metadata.result_text.trim()
      ? record.metadata.result_text
      : undefined
  const partialSummary =
    typeof record.metadata?.partial_summary === "string" && record.metadata.partial_summary.trim()
      ? record.metadata.partial_summary
      : undefined
  return resultText ?? partialSummary ?? record.result_summary ?? record.error_summary ?? `Task is ${record.status}.`
}

export function limitReason(message: MessageV2.WithParts) {
  if (message.info.role === "assistant" && message.info.finish === "step-budget") return "step_budget"
  const text = assistantText(message).toLowerCase()
  if (text.includes("step budget") && text.includes("reached")) return "step_budget"
  if (text.includes("maximum steps") && text.includes("reached")) return "step_budget"
  if (text.includes("max steps") && text.includes("reached")) return "step_budget"
  return undefined
}

export function taskGiveUpOutcome(message: MessageV2.WithParts): TaskGiveUpOutcome | undefined {
  const part = message.parts.findLast(
    (item) => item.type === "tool" && item.tool === "task_give_up" && item.state.status === "completed",
  )
  if (!part || part.type !== "tool" || part.state.status !== "completed") return
  return {
    reason: stringValue(part.state.metadata, "reason") ?? stringValue(part.state.input, "reason") ?? "unknown",
    output: part.state.output,
    partialResult: stringValue(part.state.input, "partial_result"),
    recommendNext: stringValue(part.state.input, "recommend_next"),
    inboxId: stringValue(part.state.metadata, "inbox_id"),
  }
}

export function taskRecordRetryable(record: TaskRecord) {
  if (record.metadata?.retryable === false) return false
  return record.metadata?.retryable === true || record.status === "partial"
}

export function taskPartialSummary(messages: MessageV2.WithParts[]) {
  const items = messages
    .filter((message) => message.info.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type === "text") return part.text.trim() ? [part.text.trim()] : []
        if (part.type !== "tool") return []
        if (part.state.status === "completed") {
          return [`tool ${part.tool} completed: ${part.state.output.slice(0, 300)}`]
        }
        if (part.state.status === "error") return [`tool ${part.tool} error: ${part.state.error}`]
        if (part.state.status === "running")
          return [`tool ${part.tool} running${part.state.title ? `: ${part.state.title}` : ""}`]
        return [`tool ${part.tool} pending`]
      }),
    )
  const finalText = items.findLast((item) => item.trim().length > 0)
  const summary = items.join("\n").trim()
  if (!summary) return undefined
  if (summary.length <= 4_000) return summary
  const tail = Array.from(summary).slice(-3_600).join("")
  return ["[truncated partial task history]", tail, finalText && !tail.includes(finalText) ? finalText : undefined]
    .filter((item): item is string => Boolean(item))
    .join("\n")
}

export function formatStoredRecordOutput(params: TaskParams, target: TaskTarget, record: TaskRecord): TaskOutput {
  const { sessionId, model } = target
  const retryable = taskRecordRetryable(record)
  return {
    title: params.description,
    metadata: {
      sessionId,
      model,
      taskId: sessionId,
      status: record.status,
      groupId: record.group_id,
      partial: record.status === "partial" ? true : undefined,
      retryable,
      limitReason: typeof record.metadata?.limit_reason === "string" ? record.metadata.limit_reason : undefined,
      partialSummary:
        typeof record.metadata?.partial_summary === "string" ? record.metadata.partial_summary : undefined,
      resultText: typeof record.metadata?.result_text === "string" ? record.metadata.result_text : undefined,
      remainingScope: Array.isArray(record.metadata?.remaining_scope)
        ? record.metadata.remaining_scope.filter((item): item is string => typeof item === "string")
        : undefined,
    },
    output: [
      `task_id: ${sessionId} (${record.status})`,
      "",
      `<task_result status="${record.status}">`,
      storedTaskResult(record),
      "</task_result>",
      ...(record.status === "partial"
        ? [
            "",
            retryable
              ? "Task is partial and retryable; retry only the missing scope if more evidence is required."
              : "Task stopped with a structured blocker; get user input or adjust scope before retrying.",
          ]
        : []),
    ].join("\n"),
  }
}

export function formatPendingOutput(params: TaskParams, target: TaskTarget): TaskOutput {
  const { sessionId, model } = target
  return {
    title: params.description,
    metadata: {
      sessionId,
      model,
      taskId: sessionId,
      status: "pending",
      groupId: params.group_id,
    },
    output: [
      `task_id: ${sessionId} (pending)`,
      "",
      "<task_result>",
      "Task created and queued pending dependency or write-class constraints.",
      "</task_result>",
    ].join("\n"),
  }
}

function remainingScopeFor(params: TaskParams) {
  return params.acceptance_checks ?? params.read_scope ?? params.write_scope ?? [params.description]
}

export function formatTimeoutPartialOutput(
  params: TaskParams,
  target: TaskTarget,
  summary: string,
  error: string,
): TaskOutput {
  const { sessionId, model } = target
  return {
    title: params.description,
    metadata: {
      sessionId,
      model,
      taskId: sessionId,
      status: "partial",
      groupId: params.group_id,
      error,
      retryable: true,
      partial: true,
      limitReason: "timeout",
      partialSummary: summary,
      remainingScope: remainingScopeFor(params),
    },
    output: [
      `task_id: ${sessionId} (partial, retryable)`,
      "",
      '<partial_task_result status="partial" reason="timeout">',
      summary,
      "",
      error,
      "</partial_task_result>",
    ].join("\n"),
  }
}

export function formatFailedOutput(
  params: TaskParams,
  target: TaskTarget,
  error: string,
  retryable: boolean,
  partial: string | undefined,
): TaskOutput {
  const { sessionId, model } = target
  return {
    title: params.description,
    metadata: {
      sessionId,
      model,
      taskId: sessionId,
      status: "failed",
      groupId: params.group_id,
      error,
      retryable,
      partialSummary: partial,
    },
    output: [
      `task_id: ${sessionId} (failed${retryable ? ", retryable" : ""})`,
      "",
      '<task_result status="failed">',
      error,
      "</task_result>",
      ...(partial ? ["", '<partial_task_result status="partial">', partial, "</partial_task_result>"] : []),
    ].join("\n"),
  }
}

export function formatStepBudgetPartialOutput(
  params: TaskParams,
  target: TaskTarget,
  summary: string,
  reason: string,
): TaskOutput {
  const { sessionId, model } = target
  return {
    title: params.description,
    metadata: {
      sessionId,
      model,
      taskId: sessionId,
      status: "partial",
      groupId: params.group_id,
      partial: true,
      retryable: true,
      limitReason: reason,
      partialSummary: summary,
      resultText: summary,
      remainingScope: remainingScopeFor(params),
    },
    output: [
      `task_id: ${sessionId} (partial, retryable)`,
      "",
      `<partial_task_result status="partial" reason="${reason}">`,
      summary,
      "",
      "Remaining work: retry this subagent with narrower scope or a larger step budget if the parent still needs more evidence.",
      "</partial_task_result>",
    ].join("\n"),
  }
}

export function formatGiveUpPartialOutput(
  params: TaskParams,
  target: TaskTarget,
  outcome: TaskGiveUpOutcome,
): TaskOutput {
  const { sessionId, model } = target
  return {
    title: params.description,
    metadata: {
      sessionId,
      model,
      taskId: sessionId,
      status: "partial",
      groupId: params.group_id,
      partial: true,
      retryable: false,
      limitReason: "task_give_up",
      partialSummary: outcome.output,
      resultText: outcome.output,
      remainingScope: remainingScopeFor(params),
      gaveUp: true,
      giveUpReason: outcome.reason,
      inboxId: outcome.inboxId,
      recommendNext: outcome.recommendNext,
    },
    output: [
      `task_id: ${sessionId} (partial, blocked)`,
      "",
      '<partial_task_result status="partial" reason="task_give_up">',
      outcome.output,
      "</partial_task_result>",
      "",
      "Task stopped with a structured blocker; get user input or adjust scope before retrying.",
    ].join("\n"),
  }
}

export function formatCompletedOutput(params: TaskParams, target: TaskTarget, summary: string): TaskOutput {
  const { sessionId, model } = target
  return {
    title: params.description,
    metadata: {
      sessionId,
      model,
      taskId: sessionId,
      status: "completed",
      groupId: params.group_id,
    },
    output:
      (params.return_mode ?? "id") === "summary"
        ? [
            `task_id: ${sessionId} (completed; use task_get for full result if needed)`,
            "",
            '<task_result status="completed">',
            summary,
            "</task_result>",
          ].join("\n")
        : `task_id: ${sessionId} (completed; use task_get for full result if needed)`,
  }
}
