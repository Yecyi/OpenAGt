// Shared types for dangerous command pattern detection.
// This file defines contracts only; it does not classify command text.

export interface CommandSubstitutionPattern {
  pattern: RegExp
  message: string
}

export interface ObfuscatedFlagPattern {
  pattern: RegExp
  message: string
}

export type DangerSeverity = "high" | "medium" | "low" | "safe"

export interface ValidationCheck {
  id: number
  name: string
  passed: boolean
  message?: string
}

export interface ValidationResult {
  valid: boolean
  severity: DangerSeverity
  checks: ValidationCheck[]
}
