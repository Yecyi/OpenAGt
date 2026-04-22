/**
 * PowerShell structure-aware parsing and supplemental pattern detection.
 *
 * This is intentionally lightweight: it extracts commands, parameters, values,
 * pipelines, script blocks, and subexpressions, then layers regex-only checks
 * separately instead of pretending every match came from structured parsing.
 */

import { Effect, Layer, Context } from "effect"

export type AstNodeType =
  | "program"
  | "command_invocation"
  | "command_parameter"
  | "expression"
  | "string_literal"
  | "expandable_string"
  | "script_block"
  | "subexpression"
  | "pipeline"
  | "comment"

export interface AstNode {
  type: AstNodeType
  value?: string
  children?: AstNode[]
  start: number
  end: number
}

export interface CommandInfo {
  name: string
  position: { start: number; end: number }
  arguments: Array<{ type: "parameter" | "value"; name?: string; value: string; position: { start: number; end: number } }>
  isScriptBlock: boolean
  hasPipeline: boolean
  nested: CommandInfo[]
}

export interface DangerousNode {
  nodeType: AstNodeType
  reason: string
  severity: "high" | "medium" | "low"
  position: { start: number; end: number }
  source: "ast" | "pattern"
}

export interface PowerShellAstResult {
  valid: boolean
  ast: AstNode | null
  commands: CommandInfo[]
  dangerousNodes: DangerousNode[]
  warnings: string[]
  obfuscationReport?: ObfuscationReport
}

export interface ObfuscationReport {
  aliasesExpanded: string[]
  indirectCallsDetected: string[]
  base64Attempts: number
  base64Decoded?: string
  overallRisk: "low" | "medium" | "high"
}

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
const VALUE_TOKEN_TYPES = new Set<TokenType>(["word", "string_single", "string_double", "variable", "subexpression", "script_block"])

const STRUCTURED_DANGEROUS_CMDLETS: Record<string, { severity: "high" | "medium"; reason: string }> = {
  "invoke-expression": { severity: "high", reason: "Dynamic code execution" },
  iex: { severity: "high", reason: "Invoke-Expression alias - dynamic code execution" },
  "invoke-command": { severity: "high", reason: "Remote command execution" },
  "invoke-webrequest": { severity: "medium", reason: "Network request - potential C2" },
  iwr: { severity: "medium", reason: "Invoke-WebRequest alias - potential C2" },
  "invoke-restmethod": { severity: "medium", reason: "REST API call" },
  "start-process": { severity: "medium", reason: "Process creation" },
  "new-service": { severity: "high", reason: "Service creation - persistence" },
  "set-service": { severity: "medium", reason: "Service modification" },
  "register-scheduledtask": { severity: "high", reason: "Scheduled task - persistence" },
  "schtasks.exe": { severity: "high", reason: "Scheduled task creation - persistence" },
  "set-executionpolicy": { severity: "medium", reason: "Execution policy change" },
  "new-item": { severity: "medium", reason: "New item creation" },
  "remove-item": { severity: "medium", reason: "Item deletion" },
  "convertto-securestring": { severity: "medium", reason: "Credential conversion" },
  "convertfrom-securestring": { severity: "high", reason: "Credential extraction" },
  "get-content": { severity: "medium", reason: "File content reading" },
  "set-content": { severity: "medium", reason: "File content writing" },
  "out-file": { severity: "medium", reason: "File output" },
  "add-type": { severity: "high", reason: "Dynamic type loading" },
}

const PATTERN_DANGERS: Array<{ pattern: RegExp; reason: string; severity: "high" | "medium"; nodeType: AstNodeType }> = [
  { pattern: /-enc(?:odedCommand)?\s+\S+/i, reason: "Encoded command detected", severity: "high", nodeType: "expression" },
  { pattern: /FromBase64String/i, reason: "Encoded command detected", severity: "high", nodeType: "expression" },
  { pattern: /\[Ref\]\.Assembly\.GetType/i, reason: "AMSI bypass attempt", severity: "high", nodeType: "expression" },
  { pattern: /AmsiUtils/i, reason: "AMSI bypass attempt", severity: "high", nodeType: "expression" },
  { pattern: /rundll32\.exe/i, reason: "Living-off-the-land binary usage", severity: "high", nodeType: "expression" },
  { pattern: /regsvr32\.exe/i, reason: "Living-off-the-land binary usage", severity: "high", nodeType: "expression" },
  { pattern: /mshta\.exe/i, reason: "Living-off-the-land binary usage", severity: "high", nodeType: "expression" },
  { pattern: /cscript\.exe/i, reason: "Living-off-the-land binary usage", severity: "high", nodeType: "expression" },
  { pattern: /wscript\.exe/i, reason: "Living-off-the-land binary usage", severity: "high", nodeType: "expression" },
]

/**
 * PowerShell common aliases
 */
const POWERSHELL_ALIASES: Record<string, string> = {
  "%": "ForEach-Object",
  "?": "Where-Object",
  iex: "Invoke-Expression",
  irm: "Invoke-RestMethod",
  iwr: "Invoke-WebRequest",
  ipmo: "Import-Module",
  gp: "Get-ItemProperty",
  curl: "Invoke-WebRequest",
  wget: "Invoke-WebRequest",
  curliex: "Invoke-WebRequest",
  hk: "Get-Help",
  gci: "Get-ChildItem",
  ls: "Get-ChildItem",
  dir: "Get-ChildItem",
  gc: "Get-Content",
  cat: "Get-Content",
  type: "Get-Content",
  ni: "New-Item",
  md: "New-Item",
  rm: "Remove-Item",
  rd: "Remove-Item",
  cp: "Copy-Item",
  copy: "Copy-Item",
  mv: "Move-Item",
  move: "Move-Item",
  ac: "Add-Content",
  sl: "Set-Location",
  cd: "Set-Location",
  pwd: "Get-Location",
  gl: "Get-Location",
  echo: "Write-Output",
  write: "Write-Output",
  diff: "Compare-Object",
  select: "Select-Object",
  sort: "Sort-Object",
  wv: "Where-Object",
  fl: "Format-List",
  ft: "Format-Table",
  gm: "Get-Member",
  gdr: "Get-PSDrive",
  gwmi: "Get-WmiObject",
  icm: "Invoke-Command",
  clc: "Clear-Content",
  del: "Remove-Item",
  ri: "Remove-Item",
  sc: "Set-Content",
  sp: "Set-Item",
  sv: "Set-Variable",
  si: "Set-Item",
  gi: "Get-Item",
}

function expandAliases(cmdName: string): string {
  const lower = cmdName.toLowerCase()
  return POWERSHELL_ALIASES[lower] ?? cmdName
}

function tryDecodeBase64(input: string): { decoded: string | null; depth: number } {
  let current = input
  let depth = 0
  const maxDepth = 3

  while (depth < maxDepth) {
    const trimmed = current.trim()
    if (!/^[A-Za-z0-9+/=]+$/.test(trimmed) || trimmed.length < 4) {
      break
    }
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf-8")
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded)) break
      const nextDecoded = decoded.replace(/[\r\n]+/g, " ").trim()
      if (nextDecoded.length < 4) break
      current = nextDecoded
      depth++
    } catch {
      break
    }
  }

  return depth > 0 ? { decoded: current, depth } : { decoded: null, depth: 0 }
}

function detectIndirectCalls(input: string): string[] {
  const detected: string[] = []
  const indirectPattern = /\$\w+\s*=\s*["'][^"']+["']\s*;?\s*&\s*\$/g
  let match
  while ((match = indirectPattern.exec(input)) !== null) {
    detected.push(match[0]!)
  }

  const variableCallPattern = /\$[a-zA-Z_]\w*\s*=\s*"([^"]+)"\s*;?\s*&\s*\$[a-zA-Z_]\w*/gi
  while ((match = variableCallPattern.exec(input)) !== null) {
    detected.push(match[0]!)
  }

  return detected
}

function analyzeObfuscation(input: string): ObfuscationReport {
  const aliasesExpanded: string[] = []
  const indirectCalls = detectIndirectCalls(input)

  const words = input.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []
  for (const word of words) {
    const expanded = expandAliases(word)
    if (expanded !== word) {
      aliasesExpanded.push(`${word} -> ${expanded}`)
    }
  }

  const base64Pattern = /-enc(?:odedCommand)?\s+([A-Za-z0-9+/=]+)/i
  const base64Match = base64Pattern.exec(input)
  let base64Decoded: string | undefined
  let base64Attempts = 0

  if (base64Match) {
    base64Attempts++
    const decoded = tryDecodeBase64(base64Match[1]!)
    if (decoded.decoded) {
      base64Decoded = decoded.decoded
    }
  }

  const b64InSubexpr = input.match(/\$\(([^)]+)\)/g)
  if (b64InSubexpr) {
    for (const subexpr of b64InSubexpr) {
      if (/FromBase64String/i.test(subexpr)) {
        base64Attempts++
        const inner = subexpr.match(/\$?\(([^)]+)\)/)?.[1]
        if (inner) {
          const decoded = tryDecodeBase64(inner)
          if (decoded.decoded) {
            base64Decoded = decoded.decoded
          }
        }
      }
    }
  }

  let overallRisk: "low" | "medium" | "high" = "low"
  if (indirectCalls.length > 0) {
    overallRisk = "high"
  } else if (base64Attempts > 0 && base64Decoded && base64Decoded.length >= 4) {
    overallRisk = "high"
  } else if (aliasesExpanded.length > 3) {
    overallRisk = "medium"
  }

  return {
    aliasesExpanded,
    indirectCallsDetected: indirectCalls,
    base64Attempts,
    base64Decoded,
    overallRisk,
  }
}

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
      if (input[pos] === "'" || input[pos] === '"' || (input[pos] === "$" && input[pos + 1] === "(") || input[pos] === "{") {
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

export function isDangerous(input: string): boolean {
  const result = parsePowerShellAst(input)
  if (result.dangerousNodes.some((node) => node.severity === "high")) return true
  const report = result.obfuscationReport
  if (report && report.overallRisk === "high") return true
  return false
}

export function getDangerousReasons(input: string): string[] {
  return parsePowerShellAst(input).dangerousNodes.map((node) => node.reason)
}

export function getCommandStructure(input: string): CommandInfo[] {
  return parsePowerShellAst(input).commands
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
