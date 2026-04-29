// Contracts for the unified dangerous command detector.
// This file defines result shapes only; it does not classify or scan commands.

import type { DangerSeverity } from "./danger-contracts"

export type ShellFamily = "powershell" | "posix" | "cmd" | "unknown"

export interface DangerResult {
  allowed: boolean
  severity: DangerSeverity
  reasons: string[]
  suggestions: string[]
  shellFamily: ShellFamily
  matchedPatterns: string[]
}

export interface DangerDetectorOptions {
  strictMode?: boolean
}

export interface DetectionResult {
  severity: DangerSeverity
  reasons: string[]
  patterns: string[]
}
