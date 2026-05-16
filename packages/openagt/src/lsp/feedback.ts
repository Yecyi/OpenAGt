import type { Diagnostic } from "./client"
import { report } from "./diagnostic"

export type DiagnosticMap = Record<string, Diagnostic[]>

export type DiagnosticCounts = {
  total: number
  errors: number
  warnings: number
  information: number
  hints: number
}

export type DiagnosticFeedback = {
  file: string
  status: "clean" | "has_errors" | "has_warnings"
  trend: "improved" | "regressed" | "unchanged"
  before: DiagnosticCounts
  after: DiagnosticCounts
  delta: DiagnosticCounts
  workspace: DiagnosticCounts
  new_errors: number
  fixed_errors: number
  report: string
}

export type DiagnosticRepairPlan = {
  status: "not_needed" | "retry_recommended" | "blocked"
  reason: "clean" | "warnings_only" | "outside_workspace" | "attempt_limit" | "has_errors"
  attempt: number
  max_attempts: number
  files: string[]
  diagnostics: DiagnosticCounts
}

const zero = (): DiagnosticCounts => ({
  total: 0,
  errors: 0,
  warnings: 0,
  information: 0,
  hints: 0,
})

export function countDiagnostics(items: Diagnostic[]): DiagnosticCounts {
  return items.reduce((acc, item) => {
    acc.total += 1
    if ((item.severity ?? 1) === 1) acc.errors += 1
    if (item.severity === 2) acc.warnings += 1
    if (item.severity === 3) acc.information += 1
    if (item.severity === 4) acc.hints += 1
    return acc
  }, zero())
}

function countWorkspace(map: DiagnosticMap): DiagnosticCounts {
  return countDiagnostics(Object.values(map).flat())
}

function delta(before: DiagnosticCounts, after: DiagnosticCounts): DiagnosticCounts {
  return {
    total: after.total - before.total,
    errors: after.errors - before.errors,
    warnings: after.warnings - before.warnings,
    information: after.information - before.information,
    hints: after.hints - before.hints,
  }
}

function trend(before: DiagnosticCounts, after: DiagnosticCounts): DiagnosticFeedback["trend"] {
  if (after.errors < before.errors) return "improved"
  if (after.errors > before.errors) return "regressed"
  if (after.total < before.total) return "improved"
  if (after.total > before.total) return "regressed"
  return "unchanged"
}

export function buildDiagnosticFeedback(input: {
  file: string
  normalizedFile: string
  before: DiagnosticMap
  after: DiagnosticMap
}): DiagnosticFeedback {
  const before = countDiagnostics(input.before[input.normalizedFile] ?? [])
  const after = countDiagnostics(input.after[input.normalizedFile] ?? [])
  return {
    file: input.file,
    status: after.errors > 0 ? "has_errors" : after.warnings > 0 ? "has_warnings" : "clean",
    trend: trend(before, after),
    before,
    after,
    delta: delta(before, after),
    workspace: countWorkspace(input.after),
    new_errors: Math.max(0, after.errors - before.errors),
    fixed_errors: Math.max(0, before.errors - after.errors),
    report: report(input.file, input.after[input.normalizedFile] ?? []),
  }
}

export function buildDiagnosticRepairPlan(input: {
  feedback: DiagnosticFeedback
  attempt?: number
  maxAttempts?: number
  fileInWorkspace?: boolean
}): DiagnosticRepairPlan {
  const attempt = input.attempt ?? 0
  const maxAttempts = input.maxAttempts ?? 1
  if (input.fileInWorkspace === false) {
    return {
      status: "blocked",
      reason: "outside_workspace",
      attempt,
      max_attempts: maxAttempts,
      files: [],
      diagnostics: input.feedback.after,
    }
  }
  if (input.feedback.status === "clean") {
    return {
      status: "not_needed",
      reason: "clean",
      attempt,
      max_attempts: maxAttempts,
      files: [],
      diagnostics: input.feedback.after,
    }
  }
  if (input.feedback.status === "has_warnings") {
    return {
      status: "not_needed",
      reason: "warnings_only",
      attempt,
      max_attempts: maxAttempts,
      files: [],
      diagnostics: input.feedback.after,
    }
  }
  if (attempt >= maxAttempts) {
    return {
      status: "blocked",
      reason: "attempt_limit",
      attempt,
      max_attempts: maxAttempts,
      files: [input.feedback.file],
      diagnostics: input.feedback.after,
    }
  }
  return {
    status: "retry_recommended",
    reason: "has_errors",
    attempt,
    max_attempts: maxAttempts,
    files: [input.feedback.file],
    diagnostics: input.feedback.after,
  }
}
