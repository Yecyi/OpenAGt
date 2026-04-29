// Structural shell validator rules for braces, comments, whitespace, and zsh.
// This file does not define validator ordering; validators.ts owns that order.

import { ZSH_DANGEROUS_COMMANDS } from "./danger-patterns"
import { createQuoteState, updateQuoteState } from "./quote-scanner"
import { CHECK_IDS } from "./validator-checks"
import type { ValidationContext, ValidatorResult } from "./validator-contracts"
import { CONTROL_CHAR_RE, OBFUSCATED_PATTERNS, UNICODE_WHITESPACE_RE } from "./validator-patterns"

export function validateBraceExpansion(context: ValidationContext): ValidatorResult {
  const { originalCommand, unquotedContent } = context

  let openCount = 0
  let closeCount = 0
  const state = createQuoteState()

  for (let i = 0; i < originalCommand.length; i++) {
    const char = originalCommand[i]!

    // POSIX: backslash is literal inside single quotes; everywhere else it
    // escapes the next character. Consuming the escaped pair here keeps the
    // quote-toggle logic below simple and avoids an unreliable lookbehind.
    if (char === "\\" && !state.inSingleQuote) {
      i++
      continue
    }

    if (char === "'" && !state.inDoubleQuote) {
      state.inSingleQuote = !state.inSingleQuote
      continue
    }
    if (char === '"' && !state.inSingleQuote) {
      state.inDoubleQuote = !state.inDoubleQuote
      continue
    }

    if (!state.inSingleQuote && !state.inDoubleQuote) {
      if (char === "{") {
        openCount++
      } else if (char === "}") {
        closeCount++
      }
    }
  }

  if (openCount > 0 && closeCount > openCount) {
    return {
      behavior: "ask",
      message: "Unbalanced braces detected (possible injection)",
      checkId: CHECK_IDS.BRACE_EXPANSION,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  if (openCount > 0 && /['"][{}]['"]/.test(originalCommand)) {
    return {
      behavior: "ask",
      message: "Quoted braces in command context",
      checkId: CHECK_IDS.BRACE_EXPANSION,
      subId: 2,
      isMisparsingCheck: true,
    }
  }

  const braceExpandMatch = unquotedContent.match(/\{[^}]*(?:,|\.\.)[^}]*\}/)
  if (braceExpandMatch && openCount > 0) {
    return {
      behavior: "ask",
      message: "Brace expansion detected",
      checkId: CHECK_IDS.BRACE_EXPANSION,
      subId: 3,
      isMisparsingCheck: false,
    }
  }

  return { behavior: "passthrough" }
}

export function validateControlCharacters(context: ValidationContext): ValidatorResult {
  if (CONTROL_CHAR_RE.test(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "Control characters detected",
      checkId: CHECK_IDS.CONTROL_CHARACTERS,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

export function validateUnicodeWhitespace(context: ValidationContext): ValidatorResult {
  if (UNICODE_WHITESPACE_RE.test(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "Unicode whitespace characters detected",
      checkId: CHECK_IDS.UNICODE_WHITESPACE,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

export function validateMidWordHash(context: ValidationContext): ValidatorResult {
  const { unquotedKeepQuoteChars, originalCommand } = context

  if (/\S(?<!\$\{)#/.test(unquotedKeepQuoteChars)) {
    return {
      behavior: "ask",
      message: "Hash character in middle of word",
      checkId: CHECK_IDS.MID_WORD_HASH,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  const continuedCommand = originalCommand.replace(/\\\n/g, "")
  if (/^\s*$/.test(continuedCommand) === false && /\S(?<!\$\{)#/.test(continuedCommand)) {
    return {
      behavior: "ask",
      message: "Hash after line continuation",
      checkId: CHECK_IDS.MID_WORD_HASH,
      subId: 2,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

export function validateCommentQuoteDesync(context: ValidationContext): ValidatorResult {
  const { originalCommand } = context
  const lines = originalCommand.split("\n")

  for (const line of lines) {
    const trimmedLine = line.trim()

    if (!trimmedLine || !trimmedLine.startsWith("#")) {
      continue
    }

    const commentContent = trimmedLine.slice(1)
    if (/['"]/.test(commentContent)) {
      let singleCount = 0
      let doubleCount = 0
      for (const char of commentContent) {
        if (char === "'" && !doubleCount) singleCount++
        if (char === '"' && !singleCount) doubleCount++
      }
      if (singleCount % 2 !== 0 || doubleCount % 2 !== 0) {
        return {
          behavior: "ask",
          message: "Unbalanced quotes in comment",
          checkId: CHECK_IDS.COMMENT_QUOTE_DESYNC,
          subId: 1,
          isMisparsingCheck: true,
        }
      }
    }
  }

  return { behavior: "passthrough" }
}

export function validateQuotedNewline(context: ValidationContext): ValidatorResult {
  const { originalCommand } = context
  const lines = originalCommand.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const state = createQuoteState()

    for (const char of line) {
      updateQuoteState(state, char)
    }

    if ((state.inSingleQuote || state.inDoubleQuote) && i < lines.length - 1) {
      const nextLine = lines[i + 1]?.trim()
      if (nextLine?.startsWith("#")) {
        return {
          behavior: "ask",
          message: "Unclosed quote before comment",
          checkId: CHECK_IDS.QUOTED_NEWLINE,
          subId: 1,
          isMisparsingCheck: true,
        }
      }
    }
  }

  return { behavior: "passthrough" }
}

export function validateObfuscatedFlags(context: ValidationContext): ValidatorResult {
  for (let i = 0; i < OBFUSCATED_PATTERNS.length; i++) {
    if (OBFUSCATED_PATTERNS[i]!.test(context.originalCommand)) {
      return {
        behavior: "ask",
        message: "Obfuscated flags detected",
        checkId: CHECK_IDS.OBFUSCATED_FLAGS,
        subId: i + 1,
        isMisparsingCheck: true,
      }
    }
  }

  return { behavior: "passthrough" }
}

export function validateZshDangerous(context: ValidationContext): ValidatorResult {
  const tokens = context.baseCommand.split(/\s+/)

  for (const token of tokens) {
    if (ZSH_DANGEROUS_COMMANDS.has(token)) {
      return {
        behavior: "ask",
        message: `Zsh dangerous command detected: ${token}`,
        checkId: CHECK_IDS.ZSH_DANGEROUS_COMMANDS,
        subId: 1,
        isMisparsingCheck: false,
      }
    }
  }

  if (/\bfc\s+-e/.test(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "Zsh fc command with -e flag (eval equivalent)",
      checkId: CHECK_IDS.ZSH_DANGEROUS_COMMANDS,
      subId: 2,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}
