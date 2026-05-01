import { TaskRuntime } from "@/session/task-runtime"
import { skippedVerdict, validateCritique } from "./mpacr-validation"
import { CriticalReviewVerdict, type CriticalReviewVerdict as CriticalReviewVerdictType } from "./schema"
import { nodeIDForTask } from "./task-record"

// Critical-review verdict parsing and MPACR quorum checks.
// This module interprets review task text; it does not dispatch, persist, or mutate tasks.

function hasAny(value: string, terms: string[]) {
  return terms.some((item) => value.includes(item))
}

function hasNegatedPass(value: string) {
  return /\b(does\s+not|did\s+not|do\s+not|not|cannot|can't|failed\s+to|fails\s+to)\s+pass\b/.test(value)
}

function fencedJsonCandidates(text: string) {
  return Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)).flatMap((match) => {
    const candidate = match[1]?.trim()
    return candidate ? [candidate] : []
  })
}

function balancedJsonCandidates(text: string) {
  const candidates: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (start === -1) {
      if (char === "{") {
        start = i
        depth = 1
      }
      continue
    }

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") depth++
    if (char === "}") depth--
    if (depth === 0) {
      candidates.push(text.slice(start, i + 1))
      start = -1
    }
  }

  return candidates
}

function jsonCandidates(text: string) {
  return [...fencedJsonCandidates(text), ...balancedJsonCandidates(text)]
}

export function reviewVerdictFromText(text: string | undefined): CriticalReviewVerdictType | undefined {
  if (!text) return
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = CriticalReviewVerdict.safeParse(JSON.parse(candidate))
      if (parsed.success) return parsed.data
    } catch {
      // Keep trying bounded JSON candidates before falling through to text heuristics.
    }
  }
  const normalized = text.toLowerCase()
  if (
    !hasNegatedPass(normalized) &&
    hasAny(normalized, ['"verdict":"pass"', "verdict: pass", "verdict pass", '"pass":true', "pass: true"])
  ) {
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

export function posteriorForVerdict(verdict: CriticalReviewVerdictType) {
  if (typeof verdict.posterior === "number") return verdict.posterior
  if (verdict.verdict === "pass") return verdict.confidence === "high" ? 0.9 : verdict.confidence === "low" ? 0.6 : 0.75
  if (verdict.verdict === "revise" || verdict.verdict === "retry") return 0.35
  if (verdict.verdict === "ask_user") return 0.5
  return 0.1
}

export function outcomeForVerdict(verdict: CriticalReviewVerdictType) {
  if (verdict.verdict === "pass") return 1
  if (verdict.verdict === "ask_user") return 0.5
  if (verdict.verdict === "skipped") return 0
  return 0.25
}

export function isMpacrReviewTask(metadata: Record<string, unknown> | undefined) {
  return (
    metadata?.output_schema === "revise" &&
    ["red-team-critic", "synth-reviser"].includes(typeof metadata.role === "string" ? metadata.role : "")
  )
}

export function isMpacrCriticTask(metadata: Record<string, unknown> | undefined) {
  return metadata?.output_schema === "revise" && (metadata?.mpacr_role === "critic" || metadata?.role === "red-team-critic")
}

export function reviewVerdictForMessage(
  metadata: Record<string, unknown> | undefined,
  text: string,
  originalPrompt: string,
  retryCount: number,
) {
  const parsed =
    metadata?.output_schema === "revise" || metadata?.role === "reviser" ? reviewVerdictFromText(text) : undefined
  if (!isMpacrReviewTask(metadata)) return { verdict: parsed, retryPrompt: undefined }
  const validated = validateCritique({
    raw: parsed ?? text,
    originalPrompt,
    retryCount,
  })
  if (validated.kind === "retry") return { verdict: undefined, retryPrompt: validated.sharpenedPrompt }
  return { verdict: validated.verdict, retryPrompt: undefined }
}

export function skippedReviewVerdict(reason: string) {
  return skippedVerdict(reason)
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
