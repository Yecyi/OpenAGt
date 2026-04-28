// Public contracts for shell command validators.
// This file defines shapes only; it does not inspect command text.

export type ValidationBehavior = "allow" | "ask" | "passthrough"

export interface ValidatorResult {
  behavior: ValidationBehavior
  message?: string
  checkId?: number
  subId?: number
  isMisparsingCheck?: boolean
}

export interface ValidationContext {
  originalCommand: string
  baseCommand: string
  unquotedContent: string
  fullyUnquotedContent: string
  fullyUnquotedPreStrip: string
  unquotedKeepQuoteChars: string
}

export type Validator = (context: ValidationContext) => ValidatorResult
