import path from "path"
import { Context, Effect, Layer } from "effect"
import { Config } from "@/config"
import type { PatternToken, Rule } from "@/config/exec-policy"
import type { ShellFamily } from "./shell-security"

export type ExecPolicyDecision = "allow" | "confirm" | "block"

export type MatchedRule = {
  index: number
  pattern: string[]
  decision: ExecPolicyDecision
  justification?: string
}

export type EvaluationResult = {
  tokens: string[]
  matchedRules: MatchedRule[]
  decision: ExecPolicyDecision
  justification?: string
  reason: string
}

const DECISION_ORDER: Record<ExecPolicyDecision, number> = {
  allow: 0,
  confirm: 1,
  block: 2,
}

function basenameToken(raw: string, shellFamily: ShellFamily) {
  const text = raw.trim()
  if (!text) return text
  const base = path.basename(text)
  if (shellFamily !== "powershell" && shellFamily !== "cmd") return base
  const lower = base.toLowerCase()
  for (const suffix of [".exe", ".cmd", ".bat", ".com", ".ps1"]) {
    if (lower.endsWith(suffix)) return lower.slice(0, -suffix.length)
  }
  return lower
}

function normalizeToken(raw: string, index: number, shellFamily: ShellFamily) {
  if (index !== 0) {
    return shellFamily === "powershell" || shellFamily === "cmd" ? raw.toLowerCase() : raw
  }
  const base = basenameToken(raw, shellFamily)
  return shellFamily === "powershell" || shellFamily === "cmd" ? base.toLowerCase() : base
}

function pushToken(tokens: string[], current: string[]) {
  if (current.length === 0) return
  tokens.push(current.join(""))
  current.length = 0
}

export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  const current: string[] = []
  const chars = [...command]
  let quote: '"' | "'" | null = null

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]!
    const next = chars[index + 1]
    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }
      if (
        quote === '"' &&
        char === "\\" &&
        next &&
        (next === '"' || next === "\\" || next === "$")
      ) {
        current.push(next)
        index += 1
        continue
      }
      current.push(char)
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (
      char === "\\" &&
      next &&
      (/\s/.test(next) || next === '"' || next === "'" || next === "\\")
    ) {
      current.push(next)
      index += 1
      continue
    }

    if (/\s/.test(char)) {
      pushToken(tokens, current)
      continue
    }

    current.push(char)
  }

  pushToken(tokens, current)
  return tokens
}

function matchesPattern(
  pattern: PatternToken[],
  tokens: string[],
  shellFamily: ShellFamily,
) {
  if (tokens.length < pattern.length) return false

  for (let i = 0; i < pattern.length; i++) {
    const token = pattern[i]!
    const alternatives = (Array.isArray(token) ? token : [token]) as string[]
    const actual = normalizeToken(tokens[i]!, i, shellFamily)
    const matched = alternatives.some((candidate: string) => normalizeToken(candidate, i, shellFamily) === actual)
    if (!matched) return false
  }

  return true
}

function summarizeMatch(rule: Rule) {
  return rule.pattern.map((item) => (Array.isArray(item) ? item.join("|") : item))
}

function strictestDecision(
  left: ExecPolicyDecision,
  right: ExecPolicyDecision,
): ExecPolicyDecision {
  return DECISION_ORDER[left] >= DECISION_ORDER[right] ? left : right
}

function summarizeReason(result: Omit<EvaluationResult, "reason">) {
  if (result.matchedRules.length === 0) return "No exec policy rule matched."
  const strictest = result.matchedRules.find((item) => item.decision === result.decision) ?? result.matchedRules[0]
  if (strictest?.justification) return strictest.justification
  return `Matched exec policy rule: ${strictest?.pattern.join(" ") || "unknown"}`
}

export interface Interface {
  readonly evaluate: (input: { command: string; shellFamily: ShellFamily }) => Effect.Effect<EvaluationResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ExecPolicy") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const evaluate: Interface["evaluate"] = Effect.fn("ExecPolicy.evaluate")(function* (input) {
      const cfg = yield* config.get()
      const rules = cfg.exec_policy?.rules ?? []
      const tokens = tokenizeCommand(input.command)
      const matchedRules = rules.flatMap((rule, index) => {
        if (!matchesPattern(rule.pattern, tokens, input.shellFamily)) return []
        return [{
          index,
          pattern: summarizeMatch(rule),
          decision: rule.decision ?? "allow",
          ...(rule.justification ? { justification: rule.justification } : {}),
        } satisfies MatchedRule]
      })

      const decision = matchedRules.reduce<ExecPolicyDecision>((current, rule) => {
        return strictestDecision(current, rule.decision)
      }, "allow")
      const justification = matchedRules.find((item) => item.decision === decision)?.justification
      const result = {
        tokens,
        matchedRules,
        decision,
        ...(justification ? { justification } : {}),
      }

      return {
        ...result,
        reason: summarizeReason(result),
      } satisfies EvaluationResult
    })

    return Service.of({ evaluate })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as ExecPolicy from "./exec-policy"
