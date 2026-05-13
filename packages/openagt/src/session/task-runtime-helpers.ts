// Pure helpers for task runtime summaries, usage, result DTOs, and dependency checks.
// This file does not read storage, publish events, or invoke cancel handlers.

import { MessageV2 } from "./message-v2"
import type { TaskRecord, TaskResult } from "./task-runtime"

export function summarizeMessage(text: string | undefined): string {
  if (!text) return ""
  const line = text
    .replace(/<\/?task_result(?:\s[^>]*)?>/g, "")
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean)
  return line ? Array.from(line).slice(0, 400).join("") : ""
}

export function fullMessageText(text: string | undefined): string {
  if (!text) return ""
  return text.replace(/<\/?task_result(?:\s[^>]*)?>/g, "").trim()
}

export function promptHash(prompt: string): string {
  return Bun.hash(prompt).toString(36)
}

export function normalizedUsage(info: Extract<MessageV2.Info, { role: "assistant" }>) {
  const provider = String(info.providerID)
  const totalTokens =
    info.tokens.total ??
    (provider.includes("anthropic")
      ? info.tokens.input + info.tokens.output + info.tokens.reasoning
      : info.tokens.input +
        info.tokens.output +
        info.tokens.reasoning +
        info.tokens.cache.read +
        info.tokens.cache.write)
  return {
    totalTokens,
    inputTokens: info.tokens.input,
    outputTokens: info.tokens.output,
    reasoningTokens: info.tokens.reasoning,
  }
}

export function resultFromRecord(record: TaskRecord): TaskResult {
  const metadata = record.metadata
    ? Object.fromEntries(
        [
          "coordinator_node_id",
          "coordinator_run_id",
          "role",
          "expert_id",
          "expert_role",
          "workflow",
          "effort",
          "artifact_type",
          "artifact_id",
          "revision_of",
          "quality_gate_id",
          "memory_namespace",
          "confidence",
          "revise_policy",
          "output_schema",
          "parallel_group",
          "partial",
          "retryable",
          "limit_reason",
          "partial_summary",
          "result_text",
          "review_text",
          "remaining_scope",
          "mpacr_role",
          "mpacr_perspective",
          "mpacr_quorum_pending",
          "mpacr_quorum_required",
          "mpacr_quorum_substantive_count",
          "mpacr_missing_critic_node_ids",
          "requested_step_budget",
          "effective_step_budget",
          "requested_timeout_ms",
          "effective_timeout_ms",
          "timeout_limit_reason",
          "broad_task",
          "classification_confidence",
          "classification_reasons",
          "matched_terms",
          "fallback_used",
        ].flatMap((key) => (key in record.metadata! ? [[key, record.metadata![key]] as const] : [])),
      )
    : undefined
  return {
    task_id: record.task_id,
    status: record.status,
    summary: record.result_summary ?? record.error_summary ?? `Task ${record.status}`,
    child_session_id: record.child_session_id,
    usage: record.usage,
    result_excerpt: record.result_summary,
    error_excerpt: record.error_summary,
    group_id: record.group_id,
    task_kind: record.task_kind,
    subagent_type: record.subagent_type,
    description: record.description,
    write_scope: record.write_scope,
    read_scope: record.read_scope,
    acceptance_checks: record.acceptance_checks,
    priority: record.priority,
    origin: record.origin,
    metadata,
  }
}

export function groupState(records: TaskRecord[]): string {
  if (records.some((item) => item.status === "failed")) return "failed"
  if (records.some((item) => item.status === "cancelled")) return "cancelled"
  if (records.some((item) => item.status === "partial")) return "partial"
  if (records.every((item) => item.status === "completed")) return "completed"
  if (records.some((item) => item.status === "running")) return "running"
  return "pending"
}

export function scopeOverlap(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return true
  return left.some((item) =>
    right.some((other) => item === other || item.startsWith(other + "/") || other.startsWith(item + "/")),
  )
}

export function scopedReadOverlap(left: string[], right: string[]): boolean {
  return left.length > 0 && right.length > 0 && scopeOverlap(left, right)
}
