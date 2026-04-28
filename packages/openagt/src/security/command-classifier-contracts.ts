// Contracts shared by command classifier helpers.
// This file defines result shapes only; it does not inspect commands.

import type { DangerSeverity } from "./danger-contracts"

export interface ClassificationResult {
  riskLevel: DangerSeverity
  matchedPatterns: string[]
  warnings: string[]
  sanitizedCommand: string
  shouldBlock: boolean
  bypassable: boolean
  checkId?: number
  subId?: number
}

export interface PatternCheckResult {
  matches: string[]
  warnings: string[]
}

export interface ClassifierAstNode {
  type: string
  text: () => string
  children?: readonly { type: string; text: () => string; children?: readonly unknown[] }[]
}
