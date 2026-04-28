// Contracts for the lightweight PowerShell AST heuristic result.
// This file does not tokenize, parse, or classify dangerous commands.

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
  arguments: Array<{
    type: "parameter" | "value"
    name?: string
    value: string
    position: { start: number; end: number }
  }>
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
