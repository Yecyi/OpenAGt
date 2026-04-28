/**
 * PowerShell structure-aware parsing and supplemental pattern detection.
 *
 * This is intentionally lightweight: it extracts commands, parameters, values,
 * pipelines, script blocks, and subexpressions, then layers regex-only checks
 * separately instead of pretending every match came from structured parsing.
 */

import { Effect, Layer, Context } from "effect"
import {
  expandAliases,
  PATTERN_DANGERS,
  STRUCTURED_DANGEROUS_CMDLETS,
} from "./powershell-ast-patterns"
import { analyzeObfuscation } from "./powershell-obfuscation"
import type {
  AstNode,
  AstNodeType,
  CommandInfo,
  DangerousNode,
  PowerShellAstResult,
} from "./powershell-ast-contracts"

export type {
  AstNode,
  AstNodeType,
  CommandInfo,
  DangerousNode,
  ObfuscationReport,
  PowerShellAstResult,
} from "./powershell-ast-contracts"

export { STRUCTURED_DANGEROUS_CMDLETS } from "./powershell-ast-patterns"

type TokenType =
  | "word"
  | "string_single"
  | "string_double"
  | "parameter"
  | "variable"
  | "subexpression"
  | "script_block"
  | "pipe"
  | "semicolon"
  | "comment"
  | "operator"
  | "whitespace"
  | "unknown"

interface Token {
  type: TokenType
  value: string
  start: number
  end: number
}

const COMMAND_BOUNDARY = new Set<TokenType>(["pipe", "semicolon"])
const VALUE_TOKEN_TYPES = new Set<TokenType>([
  "word",
  "string_single",
  "string_double",
  "variable",
  "subexpression",
  "script_block",
])

function readQuoted(input: string, start: number, quote: "'" | '"') {
  let pos = start + 1
  while (pos < input.length) {
    const char = input[pos]
    if (char === "`" && pos + 1 < input.length) {
      pos += 2
      continue
    }
    if (char === quote) {
      return pos + 1
    }
    pos++
  }
  return input.length
}

function readBalanced(input: string, start: number, open: string, close: string) {
  let pos = start
  let depth = 0
  while (pos < input.length) {
    const char = input[pos]
    if (char === "'" || char === '"') {
      pos = readQuoted(input, pos, char as "'" | '"')
      continue
    }
    if (char === open) depth++
    if (char === close) {
      depth--
      if (depth === 0) {
        return pos + 1
      }
    }
    pos++
  }
  return input.length
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let pos = 0

  while (pos < input.length) {
    const char = input[pos]

    if (/\s/.test(char)) {
      const start = pos
      while (pos < input.length && /\s/.test(input[pos])) pos++
      tokens.push({ type: "whitespace", value: input.slice(start, pos), start, end: pos })
      continue
    }

    if (char === "#") {
      const start = pos
      while (pos < input.length && input[pos] !== "\n") pos++
      tokens.push({ type: "comment", value: input.slice(start, pos), start, end: pos })
      continue
    }

    if (char === "$" && input[pos + 1] === "(") {
      const end = readBalanced(input, pos + 1, "(", ")")
      tokens.push({ type: "subexpression", value: input.slice(pos, end), start: pos, end })
      pos = end
      continue
    }

    if (char === "{") {
      const end = readBalanced(input, pos, "{", "}")
      tokens.push({ type: "script_block", value: input.slice(pos, end), start: pos, end })
      pos = end
      continue
    }

    if (char === "'" || char === '"') {
      const end = readQuoted(input, pos, char as "'" | '"')
      tokens.push({
        type: char === "'" ? "string_single" : "string_double",
        value: input.slice(pos, end),
        start: pos,
        end,
      })
      pos = end
      continue
    }

    if (char === "$") {
      const start = pos
      pos++
      while (pos < input.length && /[a-zA-Z0-9_:\-]/.test(input[pos])) pos++
      tokens.push({ type: "variable", value: input.slice(start, pos), start, end: pos })
      continue
    }

    if (char === "|") {
      tokens.push({ type: "pipe", value: "|", start: pos, end: pos + 1 })
      pos++
      continue
    }

    if (char === ";") {
      tokens.push({ type: "semicolon", value: ";", start: pos, end: pos + 1 })
      pos++
      continue
    }

    if (char === "=") {
      tokens.push({ type: "operator", value: "=", start: pos, end: pos + 1 })
      pos++
      continue
    }

    const start = pos
    while (pos < input.length && !/\s/.test(input[pos]) && !"|;".includes(input[pos])) {
      if (
        input[pos] === "'" ||
        input[pos] === '"' ||
        (input[pos] === "$" && input[pos + 1] === "(") ||
        input[pos] === "{"
      ) {
        break
      }
      pos++
    }

    if (pos === start) {
      tokens.push({ type: "unknown", value: input[pos], start: pos, end: pos + 1 })
      pos++
      continue
    }

    const value = input.slice(start, pos)
    tokens.push({
      type: value.startsWith("-") && /-[a-zA-Z]/.test(value) ? "parameter" : "word",
      value,
      start,
      end: pos,
    })
  }

  return tokens
}

function buildAst(tokens: Token[]): AstNode {
  const commandNodes: AstNode[] = tokens
    .filter((token) => token.type !== "whitespace")
    .map((token) => ({
      type:
        token.type === "parameter"
          ? "command_parameter"
          : token.type === "script_block"
            ? "script_block"
            : token.type === "subexpression"
              ? "subexpression"
              : token.type === "comment"
                ? "comment"
                : token.type === "pipe"
                  ? "pipeline"
                  : token.type === "string_single"
                    ? "string_literal"
                    : token.type === "string_double"
                      ? "expandable_string"
                      : "expression",
      value: token.value,
      start: token.start,
      end: token.end,
    }))

  return {
    type: "program",
    start: 0,
    end: tokens.length > 0 ? tokens[tokens.length - 1].end : 0,
    children: commandNodes,
  }
}

function shouldSkipToken(token: Token) {
  return token.type === "whitespace" || token.type === "comment"
}

function markPipeline(command: CommandInfo | null) {
  if (!command) return
  command.hasPipeline = true
}

function extractCommands(tokens: Token[]): CommandInfo[] {
  const commands: CommandInfo[] = []
  let current: CommandInfo | null = null

  const startCommand = (token: Token) => {
    const command: CommandInfo = {
      name: token.value,
      position: { start: token.start, end: token.end },
      arguments: [],
      isScriptBlock: false,
      hasPipeline: false,
      nested: [],
    }
    commands.push(command)
    current = command
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (shouldSkipToken(token)) continue

    if (COMMAND_BOUNDARY.has(token.type)) {
      if (token.type === "pipe") markPipeline(current)
      current = null
      continue
    }

    if (!current) {
      if (token.type === "word") {
        startCommand(token)
      }
      continue
    }

    const active = current as CommandInfo

    if (token.type === "parameter") {
      const next = tokens.slice(index + 1).find((candidate) => !shouldSkipToken(candidate))
      const argument = {
        type: "parameter" as const,
        name: token.value.replace(/^-+/, ""),
        value: next && VALUE_TOKEN_TYPES.has(next.type) ? next.value : "",
        position: {
          start: token.start,
          end: next && VALUE_TOKEN_TYPES.has(next.type) ? next.end : token.end,
        },
      }
      active.arguments.push(argument)
      continue
    }

    if (VALUE_TOKEN_TYPES.has(token.type)) {
      active.arguments.push({
        type: "value",
        value: token.value,
        position: { start: token.start, end: token.end },
      })
      if (token.type === "script_block") {
        active.isScriptBlock = true
        const scriptContent = token.value.slice(2, -1).trim()
        const scriptTokens = tokenize(scriptContent)
        for (const scriptToken of scriptTokens) {
          if (shouldSkipToken(scriptToken)) continue
          if (scriptToken.type === "parameter") {
            const nextIdx = scriptTokens.indexOf(scriptToken) + 1
            const next = scriptTokens.slice(nextIdx).find((c) => !shouldSkipToken(c))
            active.arguments.push({
              type: "parameter",
              name: scriptToken.value.replace(/^-+/, ""),
              value: next && VALUE_TOKEN_TYPES.has(next.type) ? next.value : "",
              position: {
                start: token.start + scriptToken.start,
                end: token.start + (next && VALUE_TOKEN_TYPES.has(next.type) ? next.end : scriptToken.end),
              },
            })
          }
        }
      }
      if (token.type === "subexpression") {
        const nested = extractCommands(tokenize(token.value.slice(2, -1)))
        active.nested.push(...nested)
      }
    }
  }

  return commands
}

function structuredDangerNodes(commands: CommandInfo[]): DangerousNode[] {
  return commands.flatMap((command) => {
    const expandedName = expandAliases(command.name)
    const dangerous = STRUCTURED_DANGEROUS_CMDLETS[expandedName.toLowerCase()]
    const nodes: DangerousNode[] = []

    if (dangerous) {
      nodes.push({
        nodeType: "command_invocation",
        reason: `${expandedName}: ${dangerous.reason}`,
        severity: dangerous.severity,
        position: command.position,
        source: "ast",
      })
    }

    for (const nested of command.nested) {
      const nestedExpanded = expandAliases(nested.name)
      const dangerousNested = STRUCTURED_DANGEROUS_CMDLETS[nestedExpanded.toLowerCase()]
      if (!dangerousNested) continue
      nodes.push({
        nodeType: "subexpression",
        reason: `${nestedExpanded}: ${dangerousNested.reason}`,
        severity: dangerousNested.severity,
        position: nested.position,
        source: "ast",
      })
    }

    return nodes
  })
}

function patternDangerNodes(input: string): DangerousNode[] {
  return PATTERN_DANGERS.flatMap((item) => {
    const match = item.pattern.exec(input)
    if (!match || match.index === undefined) return []
    return [
      {
        nodeType: item.nodeType,
        reason: item.reason,
        severity: item.severity,
        position: { start: match.index, end: match.index + match[0].length },
        source: "pattern" as const,
      },
    ]
  })
}

function dedupeDangerNodes(nodes: DangerousNode[]) {
  const seen = new Set<string>()
  return nodes.filter((node) => {
    const key = `${node.reason}:${node.position.start}:${node.position.end}:${node.source}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parsePowerShellAst(input: string): PowerShellAstResult {
  const tokens = tokenize(input)
  const ast = buildAst(tokens)
  const commands = extractCommands(tokens)
  const dangerousNodes = dedupeDangerNodes([...structuredDangerNodes(commands), ...patternDangerNodes(input)])
  const warnings = commands.length === 0 ? ["No valid commands detected"] : []
  const obfuscationReport = analyzeObfuscation(input)

  return {
    valid: commands.length > 0,
    ast,
    commands,
    dangerousNodes,
    warnings,
    obfuscationReport,
  }
}

// Single-slot memoization cache to avoid redundant parsePowerShellAst calls
// when isDangerous, getDangerousReasons, and getCommandStructure are called
// sequentially on the same input.
let _astCache: { input: string; result: ReturnType<typeof parsePowerShellAst> } | undefined

function _analyze(input: string): ReturnType<typeof parsePowerShellAst> {
  if (_astCache?.input === input) return _astCache.result
  const result = parsePowerShellAst(input)
  _astCache = { input, result }
  return result
}

export function isDangerous(input: string): boolean {
  const result = _analyze(input)
  if (result.dangerousNodes.some((node) => node.severity === "high")) return true
  const report = result.obfuscationReport
  if (report && report.overallRisk === "high") return true
  return false
}

export function getDangerousReasons(input: string): string[] {
  const result = _analyze(input)
  const nodeReasons = result.dangerousNodes.map((node) => node.reason)
  const obfuscationReasons: string[] = []
  if (result.obfuscationReport?.overallRisk === "high") {
    const { aliasesExpanded, indirectCallsDetected, base64Attempts } = result.obfuscationReport
    obfuscationReasons.push(
      `High-risk obfuscation: aliases=${aliasesExpanded.length}, indirect=${indirectCallsDetected.length}, base64=${base64Attempts}`,
    )
  }
  const seen = new Set<string>()
  const unique = [...nodeReasons, ...obfuscationReasons].filter((r) => {
    if (seen.has(r)) return false
    seen.add(r)
    return true
  })
  return unique
}

export function getCommandStructure(input: string): CommandInfo[] {
  return _analyze(input).commands
}

export interface Interface {
  readonly parse: (input: string) => Effect.Effect<PowerShellAstResult>
  readonly isDangerous: (input: string) => Effect.Effect<boolean>
  readonly getReasons: (input: string) => Effect.Effect<string[]>
  readonly getCommands: (input: string) => Effect.Effect<CommandInfo[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PowerShellAst") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const parse = Effect.fn("PowerShellAst.parse")(function* (input: string) {
      return parsePowerShellAst(input)
    })

    const isDangerousFn = Effect.fn("PowerShellAst.isDangerous")(function* (input: string) {
      return isDangerous(input)
    })

    const getReasonsFn = Effect.fn("PowerShellAst.getReasons")(function* (input: string) {
      return getDangerousReasons(input)
    })

    const getCommandsFn = Effect.fn("PowerShellAst.getCommands")(function* (input: string) {
      return getCommandStructure(input)
    })

    return Service.of({
      parse,
      isDangerous: isDangerousFn,
      getReasons: getReasonsFn,
      getCommands: getCommandsFn,
    })
  }),
)

export const defaultLayer = layer

export * as PowerShellAst from "./powershell-ast"
