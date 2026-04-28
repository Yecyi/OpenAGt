// Individual shell validator rules.
// This file returns validator decisions only; ordering is defined by validators.ts.

import { COMMAND_SUBSTITUTION_PATTERNS } from "./danger-patterns"
import { hasBackslashEscapedOperator, hasBackslashEscapedWhitespace } from "./quote-scanner"
import { CHECK_IDS } from "./validator-checks"
import type { ValidationContext, ValidatorResult } from "./validator-contracts"
import {
  GIT_COMMIT_PATTERN,
  HEREDOC_PATTERN,
  IFS_PATTERN,
  JQ_DANGEROUS_FLAGS,
  JQ_SYSTEM_PATTERN,
  PROC_ENVIRON_PATTERN,
  SAFE_HEREDOC_SUBSTITUTION_RE,
  SHELL_METACHAR_PATTERNS,
} from "./validator-patterns"

export function validateEmpty(context: ValidationContext): ValidatorResult {
  if (!context.originalCommand.trim()) {
    return { behavior: "allow", message: "Empty command" }
  }
  return { behavior: "passthrough" }
}

export function validateIncompleteCommands(context: ValidationContext): ValidatorResult {
  const command = context.originalCommand

  if (/^\s+-/.test(command)) {
    return {
      behavior: "ask",
      message: "Command appears incomplete (starts with flag)",
      checkId: CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 2,
      isMisparsingCheck: true,
    }
  }

  if (/^\s+(?:\&\&|\|\||;|>>?|<<?|<)/.test(command)) {
    return {
      behavior: "ask",
      message: "Command appears incomplete (starts with operator)",
      checkId: CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 3,
      isMisparsingCheck: true,
    }
  }

  if (/^\s/.test(command)) {
    return {
      behavior: "ask",
      message: "Command appears incomplete (starts with whitespace)",
      checkId: CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

function isSafeHeredoc(command: string): boolean {
  const match = SAFE_HEREDOC_SUBSTITUTION_RE.exec(command)
  if (!match) return false
  const delimiter = match[1] ?? match[2]
  if (!delimiter || match[4] !== delimiter) return false
  return !/(\$\(|`|\$\{)/.test(match[3] ?? "") && !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(match[3] ?? "")
}

export function validateSafeCommandSubstitution(context: ValidationContext): ValidatorResult {
  const hasHeredoc = HEREDOC_PATTERN.test(context.originalCommand)

  if (hasHeredoc && !isSafeHeredoc(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "Command contains heredoc with potentially unsafe content",
      checkId: CHECK_IDS.DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION,
      subId: 1,
      isMisparsingCheck: true,
    }
  }
  if (hasHeredoc) return { behavior: "allow", message: "Safe quoted heredoc" }

  return { behavior: "passthrough" }
}

export function validateGitCommit(context: ValidationContext): ValidatorResult {
  const match = GIT_COMMIT_PATTERN.exec(context.originalCommand)

  if (!match) {
    return { behavior: "passthrough" }
  }

  const [, , messageContent, remainder] = match

  if (/\$\(/.test(messageContent) || /`/.test(messageContent) || /\$\{/.test(messageContent)) {
    return {
      behavior: "ask",
      message: "Git commit message contains command substitution",
      checkId: CHECK_IDS.GIT_COMMIT_SUBSTITUTION,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  if (/<>|>>?/.test(remainder)) {
    return {
      behavior: "ask",
      message: "Git commit has suspicious trailing content",
      checkId: CHECK_IDS.GIT_COMMIT_SUBSTITUTION,
      subId: 2,
      isMisparsingCheck: false,
    }
  }

  if (/^["']-/.test(messageContent)) {
    return {
      behavior: "ask",
      message: "Git commit message starts with dash",
      checkId: CHECK_IDS.GIT_COMMIT_SUBSTITUTION,
      subId: 3,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

export function validateJqCommand(context: ValidationContext): ValidatorResult {
  if (JQ_SYSTEM_PATTERN.test(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "JQ command uses system() function",
      checkId: CHECK_IDS.JQ_SYSTEM_FUNCTION,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  if (JQ_DANGEROUS_FLAGS.test(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "JQ command uses potentially dangerous flags",
      checkId: CHECK_IDS.JQ_FILE_ARGUMENTS,
      subId: 1,
      isMisparsingCheck: false,
    }
  }

  return { behavior: "passthrough" }
}

export function validateShellMetacharacters(context: ValidationContext): ValidatorResult {
  for (const pattern of SHELL_METACHAR_PATTERNS) {
    if (pattern.test(context.originalCommand)) {
      return {
        behavior: "ask",
        message: "Shell metacharacters found in quoted context",
        checkId: CHECK_IDS.SHELL_METACHARACTERS,
        subId: 1,
        isMisparsingCheck: false,
      }
    }
  }

  return { behavior: "passthrough" }
}

export function validateDangerousVariables(context: ValidationContext): ValidatorResult {
  const { fullyUnquotedContent } = context

  if (/[<>|]\s*\$[A-Za-z_]/.test(fullyUnquotedContent)) {
    return {
      behavior: "ask",
      message: "Variable in dangerous context (<, >, |)",
      checkId: CHECK_IDS.DANGEROUS_VARIABLES,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  if (/\$[A-Za-z_][A-Za-z0-9_]*\s*[|<>]/.test(fullyUnquotedContent)) {
    return {
      behavior: "ask",
      message: "Variable followed by shell operator",
      checkId: CHECK_IDS.DANGEROUS_VARIABLES,
      subId: 2,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

export function validateCommandSubstitution(context: ValidationContext): ValidatorResult {
  for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
    if (pattern.test(context.fullyUnquotedContent)) {
      return {
        behavior: "ask",
        message: `Command substitution detected: ${message}`,
        checkId: CHECK_IDS.DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION,
        subId: 1,
        isMisparsingCheck: true,
      }
    }
  }

  return { behavior: "passthrough" }
}

export function validateRedirections(context: ValidationContext): ValidatorResult {
  if (/<>|>>?|<</.test(context.fullyUnquotedContent)) {
    return {
      behavior: "ask",
      message: "Input/output redirection detected",
      checkId: CHECK_IDS.DANGEROUS_PATTERNS_OUTPUT_REDIRECTION,
      subId: 1,
      isMisparsingCheck: false,
    }
  }

  return { behavior: "passthrough" }
}

export function validateNewlines(context: ValidationContext): ValidatorResult {
  const { fullyUnquotedPreStrip } = context

  if (/(?<![\\)\]])\n\s*\S/.test(fullyUnquotedPreStrip)) {
    return {
      behavior: "ask",
      message: "Newline followed by command (possible injection)",
      checkId: CHECK_IDS.NEWLINES,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  if (/\r/.test(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "Carriage return detected",
      checkId: CHECK_IDS.NEWLINES,
      subId: 2,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

export function validateIFSInjection(context: ValidationContext): ValidatorResult {
  if (IFS_PATTERN.test(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "IFS variable injection detected",
      checkId: CHECK_IDS.IFS_INJECTION,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

export function validateProcEnvironAccess(context: ValidationContext): ValidatorResult {
  if (PROC_ENVIRON_PATTERN.test(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "Access to /proc/*/environ detected",
      checkId: CHECK_IDS.PROC_ENVIRON_ACCESS,
      subId: 1,
      isMisparsingCheck: false,
    }
  }

  return { behavior: "passthrough" }
}

export function validateBackslashEscapedWhitespace(context: ValidationContext): ValidatorResult {
  if (hasBackslashEscapedWhitespace(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "Backslash-escaped whitespace detected",
      checkId: CHECK_IDS.BACKSLASH_ESCAPED_WHITESPACE,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

export function validateBackslashEscapedOperators(context: ValidationContext): ValidatorResult {
  if (hasBackslashEscapedOperator(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "Backslash-escaped shell operator detected",
      checkId: CHECK_IDS.BACKSLASH_ESCAPED_OPERATORS,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

export {
  validateBraceExpansion,
  validateCommentQuoteDesync,
  validateControlCharacters,
  validateMidWordHash,
  validateObfuscatedFlags,
  validateQuotedNewline,
  validateUnicodeWhitespace,
  validateZshDangerous,
} from "./validator-structure-rules"
