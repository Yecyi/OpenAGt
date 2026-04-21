/**
 * Command Template Module
 *
 * Extracted from session/prompt.ts
 * Handles command template variable substitution
 */

import { Agent } from "@/agent/agent"
import { AgentInfo } from "@/agent/agent"

export interface CommandTemplateContext {
  agent?: AgentInfo
  sessionID?: string
  projectPath?: string
  [key: string]: unknown
}

/**
 * Process a command template by replacing {{variable}} placeholders
 */
export function processTemplate(template: string, context: CommandTemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key === "agent" && context.agent) {
      return context.agent.id
    }
    if (key === "session" && context.sessionID) {
      return context.sessionID
    }
    if (key === "project" && context.projectPath) {
      return context.projectPath
    }
    if (context[key] !== undefined) {
      return String(context[key])
    }
    return match // Keep original if not found
  })
}

/**
 * Check if a string contains command template variables
 */
export function hasTemplateVariables(text: string): boolean {
  return /\{\{\w+\}\}/.test(text)
}

/**
 * Extract all variable names from a template
 */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g)
  if (!matches) return []
  return matches.map((m) => m.slice(2, -2))
}

/**
 * Validate that all required variables are provided
 */
export function validateTemplate(template: string, context: CommandTemplateContext): { valid: boolean; missing: string[] } {
  const required = extractTemplateVariables(template)
  const missing = required.filter((key) => context[key] === undefined)
  return {
    valid: missing.length === 0,
    missing,
  }
}
