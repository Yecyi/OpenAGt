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
import { parsePowerShellStructure } from "./powershell-ast-parser"
import type {
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
  const { ast, commands } = parsePowerShellStructure(input)
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
