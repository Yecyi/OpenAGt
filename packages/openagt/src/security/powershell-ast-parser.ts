// Tokenizes PowerShell text and extracts lightweight command structure.
// It does not classify dangerous nodes, analyze obfuscation, or expose Effect services.
import type { AstNode, CommandInfo } from "./powershell-ast-contracts"

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

export function parsePowerShellStructure(input: string): { ast: AstNode; commands: CommandInfo[] } {
  const tokens = tokenize(input)
  return {
    ast: buildAst(tokens),
    commands: extractCommands(tokens),
  }
}
