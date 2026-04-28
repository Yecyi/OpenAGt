import { TaskRuntime } from "@/session/task-runtime"
import { CriticalReviewVerdict, type CriticalReviewVerdict as CriticalReviewVerdictType } from "./schema"
import { nodeIDForTask } from "./task-record"

// Critical-review verdict parsing and MPACR quorum checks.
// This module interprets review task text; it does not dispatch, persist, or mutate tasks.

function hasAny(value: string, terms: string[]) {
  return terms.some((item) => value.includes(item))
}

export function reviewVerdictFromText(text: string | undefined): CriticalReviewVerdictType | undefined {
  if (!text) return
  const objectMatch = text.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      const parsed = CriticalReviewVerdict.safeParse(JSON.parse(objectMatch[0]))
      if (parsed.success) return parsed.data
    } catch {
      // Fall through to the line-oriented parser below.
    }
  }
  const normalized = text.toLowerCase()
  if (hasAny(normalized, ['"verdict":"pass"', "verdict: pass", "verdict pass", '"pass":true', "pass: true"])) {
    return CriticalReviewVerdict.parse({
      verdict: "pass",
      confidence: hasAny(normalized, ["confidence: high", '"confidence":"high"']) ? "high" : "medium",
    })
  }
  if (hasAny(normalized, ["ask_user", "ask user", "needs user", "user approval"])) {
    return CriticalReviewVerdict.parse({ verdict: "ask_user", required_changes: ["User input required"] })
  }
  if (hasAny(normalized, ["stop", "do not proceed", "unsafe to proceed"])) {
    return CriticalReviewVerdict.parse({ verdict: "stop", required_changes: ["Reviewer requested stop"] })
  }
  if (hasAny(normalized, ["retry", "rerun", "try again"])) {
    return CriticalReviewVerdict.parse({ verdict: "retry", required_changes: ["Reviewer requested retry"] })
  }
  if (
    hasAny(normalized, [
      '"pass":false',
      "pass: false",
      "verdict: revise",
      '"verdict":"revise"',
      "unsupported claim",
      "missing evidence",
      "contradiction",
      "required changes",
    ])
  ) {
    return CriticalReviewVerdict.parse({ verdict: "revise", required_changes: ["Reviewer found unresolved issues"] })
  }
  return
}

export function reviewFailureMessage(verdict: CriticalReviewVerdictType | undefined) {
  if (!verdict || verdict.verdict === "pass") return
  return [
    `Critical review verdict: ${verdict.verdict}`,
    verdict.unsupported_claims.length ? `unsupported claims: ${verdict.unsupported_claims.join("; ")}` : undefined,
    verdict.missing_evidence.length ? `missing evidence: ${verdict.missing_evidence.join("; ")}` : undefined,
    verdict.contradictions.length ? `contradictions: ${verdict.contradictions.join("; ")}` : undefined,
    verdict.required_changes.length ? `required changes: ${verdict.required_changes.join("; ")}` : undefined,
    verdict.confidence === "low" ? "review confidence is low" : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .join(". ")
}

export function mpacrVerdictMetadata(verdict: CriticalReviewVerdictType, extra?: Record<string, unknown>) {
  const text = JSON.stringify(verdict)
  return {
    ...(extra ?? {}),
    result_text: text,
    review_text: text,
    mpacr_validated: true,
  }
}

export function reviewVerdictForTask(task: TaskRuntime.TaskRecord) {
  if (task.metadata?.output_schema !== "revise" && task.metadata?.role !== "reviser") return
  return reviewVerdictFromText(
    (typeof task.metadata?.review_text === "string" ? task.metadata.review_text : undefined) ??
      task.result_summary ??
      task.error_summary,
  )
}

export function mpacrQuorumEscalation(record: TaskRuntime.TaskRecord, dependencies: TaskRuntime.TaskRecord[]) {
  if (record.metadata?.output_schema !== "revise" || record.metadata?.mpacr_role !== "synthesis") return
  const quorum = typeof record.metadata.mpacr_quorum === "number" ? record.metadata.mpacr_quorum : undefined
  const criticIDs = Array.isArray(record.metadata.mpacr_critic_node_ids)
    ? record.metadata.mpacr_critic_node_ids.filter((item): item is string => typeof item === "string")
    : []
  if (!quorum || criticIDs.length === 0) return
  const criticTasks = dependencies.filter((item) => {
    const nodeID = nodeIDForTask(item)
    return nodeID ? criticIDs.includes(nodeID) : false
  })
  const parsed = criticTasks.flatMap((item) => {
    const verdict = reviewVerdictForTask(item)
    const nodeID = nodeIDForTask(item)
    return verdict && nodeID ? [{ nodeID, verdict }] : []
  })
  const substantive = parsed.filter((item) => item.verdict.verdict !== "skipped").length
  if (substantive >= quorum) return
  const missing = criticIDs.filter(
    (id) => !parsed.some((item) => item.nodeID === id && item.verdict.verdict !== "skipped"),
  )
  return {
    quorum,
    substantive,
    missing,
    verdict: CriticalReviewVerdict.parse({
      verdict: "ask_user",
      missing_evidence: [`Only ${substantive} of ${quorum} required MPACR critics produced substantive verdicts.`],
      required_changes: [
        `MPACR quorum unmet; missing substantive critic perspectives: ${missing.join(", ") || "unknown"}.`,
      ],
      confidence: "low",
      evidence_for: parsed
        .filter((item) => item.verdict.verdict !== "skipped")
        .map((item) => `${item.nodeID}: ${item.verdict.verdict}`),
      evidence_against: missing.map((id) => `${id}: no substantive verdict`),
    }),
  }
}
