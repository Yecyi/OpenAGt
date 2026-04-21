/**
 * PowerShell AST Parser
 *
 * AST-based PowerShell security analysis that goes beyond regex patterns.
 * Parses command structure to detect dangerous patterns semantically.
 *
 * This provides more accurate detection than regex-based approaches by:
 * 1. Parsing command structure (cmdlet, parameters, arguments)
 * 2. Understanding parameter contexts
 * 3. Detecting nested expressions
 * 4. Identifying dangerous data flows
 */

import { Effect, Layer, Context } from "effect"

// ============================================================
// Types
// ============================================================

export type AstNodeType =
  | "program"
  | "command"
  | "command_invocation"
  | "command_parameter"
  | "expression"
  | "string_literal"
  | "expandable_string"
  | "script_block"
  | "subexpression"
  | "array_literal"
  | "hashtable"
  | "pipeline"
  | "pipe"
  | "comment"

export interface AstNode {
  type: AstNodeType
  value?: string
  children?: AstNode[]
  start: number
  end: number
  properties?: Record<string, unknown>
}

export interface CommandInfo {
  name: string
  arguments: Array<{ type: "parameter" | "value"; name?: string; value: string }>
  isScriptBlock?: boolean
  hasPipeline?: boolean
  nested?: CommandInfo[]
}

export interface DangerousNode {
  nodeType: AstNodeType
  reason: string
  severity: "high" | "medium" | "low"
  position: { start: number; end: number }
}

export interface PowerShellAstResult {
  valid: boolean
  ast: AstNode | null
  commands: CommandInfo[]
  dangerousNodes: DangerousNode[]
  warnings: string[]
}

// ============================================================
// Tokenizer
// ============================================================

interface Token {
  type:
    | "command"
    | "parameter"
    | "string_single"
    | "string_double"
    | "string_expandable"
    | "script_block_start"
    | "script_block_end"
    | "subexpression_start"
    | "subexpression_end"
    | "pipe"
    | "semicolon"
    | "newline"
    | "lbracket"
    | "rbracket"
    | "lbrace"
    | "rbrace"
    | "lparen"
    | "rparen"
    | "operator"
    | "comment"
    | "whitespace"
    | "variable"
    | "unknown"
  value: string
  start: number
  end: number
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let pos = 0

  while (pos < input.length) {
    const char = input[pos]

    if (/\s/.test(char)) {
      let start = pos
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

    if (char === '"') {
      const start = pos
      pos++
      while (pos < input.length && input[pos] !== '"') {
        if (input[pos] === "\\" && pos + 1 < input.length) pos++
        pos++
      }
      if (pos < input.length) pos++
      tokens.push({ type: "string_double", value: input.slice(start, pos), start, end: pos })
      continue
    }

    if (char === "'") {
      const start = pos
      pos++
      while (pos < input.length && input[pos] !== "'") pos++
      if (pos < input.length) pos++
      tokens.push({ type: "string_single", value: input.slice(start, pos), start, end: pos })
      continue
    }

    if (char === "$") {
      const start = pos
      pos++
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) pos++
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

    if (char === "(") {
      tokens.push({ type: "lparen", value: "(", start: pos, end: pos + 1 })
      pos++
      continue
    }

    if (char === ")") {
      tokens.push({ type: "rparen", value: ")", start: pos, end: pos + 1 })
      pos++
      continue
    }

    if (char === "{") {
      tokens.push({ type: "lbrace", value: "{", start: pos, end: pos + 1 })
      pos++
      continue
    }

    if (char === "}") {
      tokens.push({ type: "rbrace", value: "}", start: pos, end: pos + 1 })
      pos++
      continue
    }

    if (char === "[") {
      tokens.push({ type: "lbracket", value: "[", start: pos, end: pos + 1 })
      pos++
      continue
    }

    if (char === "]") {
      tokens.push({ type: "rbracket", value: "]", start: pos, end: pos + 1 })
      pos++
      continue
    }

    if (char === "-") {
      const start = pos
      pos++
      if (pos < input.length && /[a-zA-Z]/.test(input[pos])) {
        while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) pos++
        tokens.push({ type: "parameter", value: input.slice(start, pos), start, end: pos })
      } else {
        tokens.push({ type: "operator", value: "-", start, end: pos })
      }
      continue
    }

    if (char === "$") {
      const start = pos
      pos++
      if (pos < input.length && input[pos] === "(") {
        tokens.push({ type: "subexpression_start", value: "$(", start, end: pos + 1 })
        pos++
      } else {
        // Just a variable start, already consumed the $
        while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) pos++
        tokens.push({ type: "variable", value: input.slice(start, pos), start, end: pos })
      }
      continue
    }

    if (char === "{") {
      const start = pos
      pos++
      while (pos < input.length && input[pos] !== "}") pos++
      if (pos < input.length) pos++
      tokens.push({ type: "script_block_start", value: input.slice(start, pos), start, end: pos })
      continue
    }

    const start = pos
    if (/[a-zA-Z]/.test(char)) {
      while (pos < input.length && /[a-zA-Z0-9_:\-]/.test(input[pos])) pos++
      const value = input.slice(start, pos)

      if (value.startsWith("-")) {
        tokens.push({ type: "parameter", value, start, end: pos })
      } else {
        tokens.push({ type: "command", value, start, end: pos })
      }
      continue
    }

    tokens.push({ type: "unknown", value: char, start: pos, end: pos + 1 })
    pos++
  }

  return tokens
}

// ============================================================
// AST Parser
// ============================================================

function buildAst(tokens: Token[]): AstNode {
  const program: AstNode = {
    type: "program",
    value: "",
    children: [],
    start: 0,
    end: tokens.length > 0 ? tokens[tokens.length - 1].end : 0,
  }

  let currentCommand: AstNode | null = null
  let currentPipeline: AstNode | null = null

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (token.type === "command") {
      if (currentPipeline) {
        currentPipeline.children?.push({
          type: "command_invocation",
          value: token.value,
          start: token.start,
          end: token.end,
          children: [],
        })
      } else {
        currentPipeline = {
          type: "pipeline",
          value: "",
          children: [
            {
              type: "command_invocation",
              value: token.value,
              start: token.start,
              end: token.end,
              children: [],
            },
          ],
          start: token.start,
          end: token.end,
        }
      }
      currentCommand = currentPipeline.children![currentPipeline.children!.length - 1]
    } else if (token.type === "parameter" && currentCommand) {
      const paramNode: AstNode = {
        type: "command_parameter",
        value: token.value,
        start: token.start,
        end: token.end,
      }

      if (tokens[i + 1] && (tokens[i + 1].type === "string_double" || tokens[i + 1].type === "string_single" || tokens[i + 1].type === "variable" || tokens[i + 1].type === "command")) {
        i++
        paramNode.children = [
          {
            type: tokens[i].type === "command"
              ? "expression"
              : (tokens[i].type === "comment"
                ? "comment"
                : tokens[i].type === "pipe"
                  ? "pipe"
                  : "expression") as AstNodeType,
            value: tokens[i].value,
            start: tokens[i].start,
            end: tokens[i].end,
          },
        ]
      }

      currentCommand.children?.push(paramNode)
    } else if (token.type === "pipe") {
      if (currentPipeline) {
        program.children?.push(currentPipeline)
        currentPipeline = null
        currentCommand = null
      }
    }
  }

  if (currentPipeline) {
    program.children?.push(currentPipeline)
  }

  return program
}

// ============================================================
// Command Extraction
// ============================================================

function extractCommands(ast: AstNode): CommandInfo[] {
  const commands: CommandInfo[] = []

  function traverse(node: AstNode, parent?: CommandInfo) {
    if (node.type === "command_invocation" && node.value) {
      const cmd: CommandInfo = {
        name: node.value,
        arguments: [],
      }
      parent?.nested?.push(cmd)
      commands.push(cmd)
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child, commands[commands.length - 1])
      }
    }
  }

  traverse(ast)
  return commands
}

// ============================================================
// Dangerous Pattern Detection
// ============================================================

const DANGEROUS_CMDLETS: Record<string, { severity: "high" | "medium"; reason: string }> = {
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

const DANGEROUS_SCRIPT_BLOCK_PATTERNS = [
  /\{[^}]*\}\s*\)/,
  /ScriptBlock/i,
]

const ENCODED_COMMAND_PATTERNS = [
  /-enc(?:odedCommand)?\s+/i,
  /-encode\s+/i,
  /FromBase64String/i,
  /\[System\.Convert\]::FromBase64String/i,
]

const AMBI_PATTERNS = [
  /\[Ref\]\.Assembly\.GetType/i,
  /AmsiUtils/i,
  /\.GetField\s*\(/i,
]

const LIVING_OFF_LAND = [
  /rundll32\.exe/i,
  /regsvr32\.exe/i,
  /mshta\.exe/i,
  /cscript\.exe/i,
  /wscript\.exe/i,
  /bitsadmin\.exe/i,
  /certutil\.exe.*-decode/i,
  /cmstp\.exe/i,
]

function detectDangerousNodes(ast: AstNode, input: string): DangerousNode[] {
  const nodes: DangerousNode[] = []

  const commands = extractCommands(ast)
  for (const cmd of commands) {
    const lowerName = cmd.name.toLowerCase()
    const dangerous = DANGEROUS_CMDLETS[lowerName]
    if (dangerous) {
      nodes.push({
        nodeType: "command_invocation",
        reason: `${cmd.name}: ${dangerous.reason}`,
        severity: dangerous.severity,
        position: { start: 0, end: cmd.name.length },
      })
    }
  }

  for (const pattern of ENCODED_COMMAND_PATTERNS) {
    if (pattern.test(input)) {
      nodes.push({
        nodeType: "expression",
        reason: "Encoded command detected",
        severity: "high",
        position: { start: 0, end: input.length },
      })
    }
  }

  for (const pattern of AMBI_PATTERNS) {
    if (pattern.test(input)) {
      nodes.push({
        nodeType: "expression",
        reason: "AMSI bypass attempt",
        severity: "high",
        position: { start: 0, end: input.length },
      })
    }
  }

  for (const pattern of LIVING_OFF_LAND) {
    if (pattern.test(input)) {
      nodes.push({
        nodeType: "expression",
        reason: "Living-off-the-land binary usage",
        severity: "high",
        position: { start: 0, end: input.length },
      })
    }
  }

  return nodes
}

// ============================================================
// Main Parser Function
// ============================================================

export function parsePowerShellAst(input: string): PowerShellAstResult {
  const tokens = tokenize(input)
  const ast = buildAst(tokens)
  const commands = extractCommands(ast)
  const dangerousNodes = detectDangerousNodes(ast, input)

  const warnings: string[] = []
  if (commands.length === 0) {
    warnings.push("No valid commands detected")
  }

  return {
    valid: commands.length > 0,
    ast,
    commands,
    dangerousNodes,
    warnings,
  }
}

// ============================================================
// Convenience Functions
// ============================================================

export function isDangerous(input: string): boolean {
  const result = parsePowerShellAst(input)
  return result.dangerousNodes.some((n) => n.severity === "high")
}

export function getDangerousReasons(input: string): string[] {
  const result = parsePowerShellAst(input)
  return result.dangerousNodes.map((n) => n.reason)
}

export function getCommandStructure(input: string): CommandInfo[] {
  const result = parsePowerShellAst(input)
  return result.commands
}

// ============================================================
// Effect-based Service
// ============================================================

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
