/**
 * MCP Tool Quality Checklist
 *
 * Checklist for ensuring MCP tool definitions meet quality standards.
 * This helps verify that tools from MCP servers are properly defined
 * with complete schemas, descriptions, and error handling.
 */

import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"

export interface ToolQualityChecklist {
  hasValidSchema: boolean
  hasDescription: boolean
  hasParameterDescriptions: boolean
  hasReturnTypeDescription: boolean
  hasExamples: boolean
  hasVersion: boolean
  isNamingConsistent: boolean
  hasDeprecationWarning: boolean
}

export interface ToolQualityReport {
  toolName: string
  clientName: string
  checks: ToolQualityChecklist
  overallScore: number
  issues: string[]
  suggestions: string[]
}

const QUALITY_WEIGHTS: Record<keyof ToolQualityChecklist, number> = {
  hasValidSchema: 20,
  hasDescription: 15,
  hasParameterDescriptions: 20,
  hasReturnTypeDescription: 10,
  hasExamples: 10,
  hasVersion: 5,
  isNamingConsistent: 10,
  hasDeprecationWarning: 10,
}

export function checkToolQuality(tool: MCPToolDef, clientName: string): ToolQualityReport {
  const issues: string[] = []
  const suggestions: string[] = []

  const checks: ToolQualityChecklist = {
    hasValidSchema: !!(tool.inputSchema && typeof tool.inputSchema === "object" && tool.inputSchema.properties),
    hasDescription: !!(tool.description && tool.description.length > 10),
    hasParameterDescriptions: checkParameterDescriptions(tool.inputSchema),
    hasReturnTypeDescription: false,
    hasExamples: false,
    hasVersion: false,
    isNamingConsistent: isNamingConsistent(tool.name),
    hasDeprecationWarning: !!(tool.description?.toLowerCase().includes("deprecated")),
  }

  if (!checks.hasValidSchema) {
    issues.push("Missing or invalid input schema")
    suggestions.push("Add an inputSchema with properties defined")
  }

  if (!checks.hasDescription) {
    issues.push("Missing or insufficient description")
    suggestions.push("Add a detailed description (at least 10 characters)")
  }

  if (!checks.hasParameterDescriptions) {
    issues.push("Parameters lack descriptions")
    suggestions.push("Add descriptions to each parameter in the schema")
  }

  if (!checks.isNamingConsistent) {
    issues.push("Inconsistent naming convention")
    suggestions.push("Use snake_case or camelCase consistently")
  }

  const overallScore = calculateScore(checks)

  return {
    toolName: tool.name,
    clientName,
    checks,
    overallScore,
    issues,
    suggestions,
  }
}

function checkParameterDescriptions(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false
  const s = schema as Record<string, unknown>
  const properties = s.properties as Record<string, unknown> | undefined
  if (!properties) return true

  return Object.values(properties).every((prop) => {
    if (typeof prop !== "object" || prop === null) return false
    return !!(prop as Record<string, unknown>).description
  })
}

function isNamingConsistent(name: string): boolean {
  const snakeCase = /^[a-z][a-z0-9_]*$/
  const camelCase = /^[a-z][a-zA-Z0-9]*$/
  const kebabCase = /^[a-z][a-z0-9-]*$/

  return !!(snakeCase.test(name) || camelCase.test(name) || kebabCase.test(name))
}

function calculateScore(checks: ToolQualityChecklist): number {
  let score = 0
  let totalWeight = 0

  for (const [key, weight] of Object.entries(QUALITY_WEIGHTS)) {
    totalWeight += weight
    if (checks[key as keyof ToolQualityChecklist]) {
      score += weight
    }
  }

  return Math.round((score / totalWeight) * 100)
}

export function checkToolsQuality(
  tools: Array<{ tool: MCPToolDef; clientName: string }>,
): {
  reports: ToolQualityReport[]
  averageScore: number
  highQualityTools: string[]
  lowQualityTools: string[]
  commonIssues: Record<string, number>
} {
  const reports = tools.map(({ tool, clientName }) => checkToolQuality(tool, clientName))
  const averageScore = reports.length > 0 ? Math.round(reports.reduce((sum, r) => sum + r.overallScore, 0) / reports.length) : 0

  const highQualityTools = reports.filter((r) => r.overallScore >= 80).map((r) => `${r.clientName}:${r.toolName}`)
  const lowQualityTools = reports.filter((r) => r.overallScore < 50).map((r) => `${r.clientName}:${r.toolName}`)

  const commonIssues: Record<string, number> = {}
  for (const report of reports) {
    for (const issue of report.issues) {
      commonIssues[issue] = (commonIssues[issue] || 0) + 1
    }
  }

  return {
    reports,
    averageScore,
    highQualityTools,
    lowQualityTools,
    commonIssues,
  }
}

export function generateToolDocumentation(tool: MCPToolDef, clientName: string): string {
  const lines: string[] = []

  lines.push(`## ${tool.name}`)
  lines.push("")
  lines.push(`**Client:** ${clientName}`)
  lines.push("")
  lines.push(`### Description`)
  lines.push(tool.description || "_No description provided_")
  lines.push("")

  if (tool.inputSchema && typeof tool.inputSchema === "object") {
    const schema = tool.inputSchema as Record<string, unknown>
    if (schema.properties) {
      lines.push(`### Parameters`)
      lines.push("")
      const props = schema.properties as Record<string, unknown>
      for (const [name, prop] of Object.entries(props)) {
        const p = prop as Record<string, unknown>
        const required = (schema.required as string[] | undefined)?.includes(name)
        lines.push(`- \`${name}\`${required ? " (required)" : ""}: ${p.description || "_No description_"}`)
        if (p.type) {
          lines.push(`  - Type: ${p.type}`)
        }
        if (p.enum) {
          lines.push(`  - Options: ${(p.enum as unknown[]).join(", ")}`)
        }
      }
      lines.push("")
    }
  }

  return lines.join("\n")
}

export * as ToolQuality from "./tool-quality"
