import z from "zod"
import { Effect } from "effect"
import { MessageV2 } from "@/session/message-v2"
import type { SessionID } from "@/session/schema"

export const VerifierSignal = z.object({
  source: z.enum(["llm_critic", "lsp_diagnostics", "typecheck", "test_subset"]),
  status: z.enum(["pass", "warning", "hard_fail", "timeout", "unavailable"]),
  summary: z.string().default(""),
  evidence: z.array(z.string()).default([]),
})
export type VerifierSignal = z.infer<typeof VerifierSignal>
export type VerifierSignalInput = z.input<typeof VerifierSignal>

export const AggregatedVerifierVerdict = z.object({
  verdict: z.enum(["pass", "pass_with_followup", "revise_required", "inconclusive"]),
  hard_fail_sources: z.array(VerifierSignal.shape.source).default([]),
  warning_sources: z.array(VerifierSignal.shape.source).default([]),
  unavailable_sources: z.array(VerifierSignal.shape.source).default([]),
  evidence: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
})
export type AggregatedVerifierVerdict = z.infer<typeof AggregatedVerifierVerdict>

export function aggregateVerifierSignals(input: readonly VerifierSignalInput[]) {
  const signals = VerifierSignal.array().parse(input)
  const hardFails = signals.filter((item) => item.status === "hard_fail")
  const warnings = signals.filter((item) => item.status === "warning")
  const unavailable = signals.filter((item) => item.status === "timeout" || item.status === "unavailable")
  const evidence = signals.flatMap((item) => [
    item.summary ? `${item.source}: ${item.summary}` : undefined,
    ...item.evidence.map((entry) => `${item.source}: ${entry}`),
  ]).filter((item): item is string => Boolean(item))

  if (hardFails.length > 0) {
    return AggregatedVerifierVerdict.parse({
      verdict: "revise_required",
      hard_fail_sources: hardFails.map((item) => item.source),
      warning_sources: warnings.map((item) => item.source),
      unavailable_sources: unavailable.map((item) => item.source),
      evidence,
      confidence: "high",
    })
  }
  if (signals.length === 0 || signals.every((item) => item.status === "timeout" || item.status === "unavailable")) {
    return AggregatedVerifierVerdict.parse({
      verdict: "inconclusive",
      unavailable_sources: unavailable.map((item) => item.source),
      evidence,
      confidence: "low",
    })
  }
  if (warnings.length > 0 || unavailable.length > 0) {
    return AggregatedVerifierVerdict.parse({
      verdict: "pass_with_followup",
      warning_sources: warnings.map((item) => item.source),
      unavailable_sources: unavailable.map((item) => item.source),
      evidence,
      confidence: unavailable.length > 0 ? "medium" : "high",
    })
  }
  return AggregatedVerifierVerdict.parse({
    verdict: "pass",
    evidence,
    confidence: "high",
  })
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function commandSource(command: string): "typecheck" | "test_subset" | undefined {
  const normalized = command.toLowerCase()
  if (/\b(typecheck|tsgo|tsc|eslint|oxlint|biome|lint)\b/.test(normalized)) return "typecheck"
  if (/\b(bun\s+test|npm\s+test|pnpm\s+test|yarn\s+test|vitest|jest|playwright)\b/.test(normalized)) {
    return "test_subset"
  }
}

function diagnosticsFrom(value: unknown, depth = 0): { total: number; errors: number; warnings: number } {
  if (depth > 8) return { total: 0, errors: 0, warnings: 0 }
  if (Array.isArray(value)) {
    return value.map((item) => diagnosticsFrom(item, depth + 1)).reduce(
      (acc, item) => ({
        total: acc.total + item.total,
        errors: acc.errors + item.errors,
        warnings: acc.warnings + item.warnings,
      }),
      { total: 0, errors: 0, warnings: 0 },
    )
  }
  const current = record(value)
  if (!current) return { total: 0, errors: 0, warnings: 0 }
  const severity = numberValue(current.severity)
  if (severity) {
    return {
      total: 1,
      errors: severity === 1 ? 1 : 0,
      warnings: severity === 2 ? 1 : 0,
    }
  }
  return Object.values(current)
    .map((item) => diagnosticsFrom(item, depth + 1))
    .reduce(
      (acc, item) => ({
        total: acc.total + item.total,
        errors: acc.errors + item.errors,
        warnings: acc.warnings + item.warnings,
      }),
      { total: 0, errors: 0, warnings: 0 },
    )
}

function bashSignal(part: MessageV2.ToolPart): VerifierSignalInput[] {
  if (part.tool !== "bash") return []
  const source = commandSource(stringValue(part.state.input.command) ?? stringValue(part.state.input.cmd) ?? "")
  if (!source) return []
  if (part.state.status === "error") {
    return [
      {
        source,
        status: "hard_fail",
        summary: part.state.error.slice(0, 240),
      },
    ]
  }
  if (part.state.status !== "completed") return []
  const metadata = record(part.state.metadata)
  const exit = numberValue(metadata?.exit)
  return [
    {
      source,
      status: exit === undefined || exit === 0 ? "pass" : "hard_fail",
      summary: `Command exited ${exit ?? 0}: ${stringValue(part.state.input.command) ?? part.tool}`,
      evidence: [part.state.output.slice(0, 1_000)].filter((item) => item.length > 0),
    },
  ]
}

function diagnosticSignal(part: MessageV2.ToolPart): VerifierSignalInput[] {
  const state = part.state
  const metadata = state.status === "completed" || state.status === "running" || state.status === "error"
    ? record(state.metadata)
    : undefined
  const counts = diagnosticsFrom(metadata?.diagnostics ?? metadata?.result)
  if (counts.total === 0) return []
  return [
    {
      source: "lsp_diagnostics",
      status: counts.errors > 0 ? "hard_fail" : counts.warnings > 0 ? "warning" : "pass",
      summary: `${counts.errors} errors, ${counts.warnings} warnings across ${counts.total} diagnostics`,
    },
  ]
}

export function verifierSignalsFromMessages(messages: readonly MessageV2.WithParts[]) {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== "tool") return []
      return [...bashSignal(part), ...diagnosticSignal(part)]
    }),
  )
}

export const collectVerifierSignals = Effect.fn("VerifierAggregator.collectSignals")(function* (input: {
  childSessionID: SessionID
}) {
  return yield* Effect.sync(() => verifierSignalsFromMessages([...MessageV2.stream(input.childSessionID)]))
})
