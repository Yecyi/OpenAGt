/**
 * CC-Style Security Validators
 *
 * Public facade for command security validators. Concrete validator rules live
 * in validator-rules.ts; this file preserves the external import surface and
 * validator execution order.
 *
 * Reference: Code Reference/CC Source Code/src/tools/BashTool/bashSecurity.ts
 */

import type { ValidationContext, Validator, ValidatorResult } from "./validator-contracts"
import {
  validateBackslashEscapedOperators,
  validateBackslashEscapedWhitespace,
  validateBraceExpansion,
  validateCommandSubstitution,
  validateCommentQuoteDesync,
  validateControlCharacters,
  validateDangerousVariables,
  validateEmpty,
  validateGitCommit,
  validateIFSInjection,
  validateIncompleteCommands,
  validateJqCommand,
  validateMidWordHash,
  validateNewlines,
  validateObfuscatedFlags,
  validateProcEnvironAccess,
  validateQuotedNewline,
  validateRedirections,
  validateSafeCommandSubstitution,
  validateShellMetacharacters,
  validateUnicodeWhitespace,
  validateZshDangerous,
} from "./validator-rules"

export * from "./validator-contracts"
export * from "./validator-rules"

export const earlyValidators: Validator[] = [
  validateEmpty,
  validateIncompleteCommands,
  validateSafeCommandSubstitution,
  validateGitCommit,
]

export const mainValidators: Validator[] = [
  validateJqCommand,
  validateObfuscatedFlags,
  validateShellMetacharacters,
  validateDangerousVariables,
  validateCommentQuoteDesync,
  validateQuotedNewline,
  validateNewlines,
  validateIFSInjection,
  validateProcEnvironAccess,
  validateCommandSubstitution,
  validateRedirections,
  validateBackslashEscapedWhitespace,
  validateBackslashEscapedOperators,
  validateUnicodeWhitespace,
  validateMidWordHash,
  validateBraceExpansion,
  validateZshDangerous,
  validateControlCharacters,
]

export function createValidationContext(command: string): ValidationContext {
  const baseCommand = command.trim().split(/\s+/)[0] || ""
  const unquotedContent = command.replace(/['"][^'"]*['"]/g, "")

  return {
    originalCommand: command,
    baseCommand,
    unquotedContent,
    fullyUnquotedContent: unquotedContent,
    fullyUnquotedPreStrip: unquotedContent,
    unquotedKeepQuoteChars: command,
  }
}

export function validateCommand(command: string): ValidatorResult {
  const context = createValidationContext(command)

  for (const validator of earlyValidators) {
    const result = validator(context)
    if (result.behavior !== "passthrough") {
      return result
    }
  }

  for (const validator of mainValidators) {
    const result = validator(context)
    if (result.behavior !== "passthrough") {
      return result
    }
  }

  return { behavior: "allow" }
}

export function isCommandSafe(command: string): boolean {
  if (!command.trim()) return true

  const lower = command.toLowerCase().trim()
  if (lower === "ls" || lower === "dir" || lower === "pwd" || lower === "echo" || lower === "cat" || lower === "type") {
    return true
  }

  return validateCommand(command).behavior === "allow"
}
