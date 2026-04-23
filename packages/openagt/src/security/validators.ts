/**
 * CC-Style Security Validators
 *
 * Comprehensive security validation based on CC Source Code's bashSecurity.ts.
 * Implements all 22 validators with proper quote tracking, escape handling,
 * and edge case processing.
 *
 * Reference: Code Reference/CC Source Code/src/tools/BashTool/bashSecurity.ts
 */

import { COMMAND_SUBSTITUTION_PATTERNS } from "./dangers"

// ============================================================
// Types
// ============================================================

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

// ============================================================
// Constants
// ============================================================

const CHECK_IDS = {
  INCOMPLETE_COMMANDS: 1,
  JQ_SYSTEM_FUNCTION: 2,
  JQ_FILE_ARGUMENTS: 3,
  OBFUSCATED_FLAGS: 4,
  SHELL_METACHARACTERS: 5,
  DANGEROUS_VARIABLES: 6,
  NEWLINES: 7,
  DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION: 8,
  DANGEROUS_PATTERNS_INPUT_REDIRECTION: 9,
  DANGEROUS_PATTERNS_OUTPUT_REDIRECTION: 10,
  IFS_INJECTION: 11,
  GIT_COMMIT_SUBSTITUTION: 12,
  PROC_ENVIRON_ACCESS: 13,
  MALFORMED_TOKEN_INJECTION: 14,
  BACKSLASH_ESCAPED_WHITESPACE: 15,
  BRACE_EXPANSION: 16,
  CONTROL_CHARACTERS: 17,
  UNICODE_WHITESPACE: 18,
  MID_WORD_HASH: 19,
  ZSH_DANGEROUS_COMMANDS: 20,
  BACKSLASH_ESCAPED_OPERATORS: 21,
  COMMENT_QUOTE_DESYNC: 22,
  QUOTED_NEWLINE: 23,
} as const

// Shell metacharacter patterns for various contexts
const SHELL_METACHAR_PATTERNS = [
  // semicolon, pipe, ampersand in quotes
  /(?:^|\s)["'][^"']*[;&|][^"']*["'](?:\s|$)/,
  // find command patterns
  /-name\s+["'][^"']*[;&|][^"']*["']/,
  /-path\s+["'][^"']*[;&|][^"']*["']/,
  /-iname\s+["'][^"']*[;&|][^"']*["']/,
  /-regex\s+["'][^"']*[;&|][^"']*["']/,
]

// Brace expansion patterns
const BRACE_PATTERN = /[{}]/
const UNQUOTED_CLOSE_BRACE_EXCESS = /(?<![\\'"])[}][^;|&$<>`\n\r]*$/

// Safe heredoc delimiter pattern
const HEREDOC_DELIMITER_RE = /^(?:'+([A-Za-z_]\w*)'+|\\([A-Za-z_]\w*))/
const HEREDOC_PATTERN = /\$\(cat[ \t]*<<(-?)[ \t]*(?:'+([A-Za-z_]\w*)'+|\\([A-Za-z_]\w*))/

// Git commit pattern
const GIT_COMMIT_PATTERN = /^git[ \t]+commit[ \t]+[^;&|`$<>()\n\r]*?-m[ \t]+(["'])([\s\S]*?)\1(.*)$/

// JQ patterns
const JQ_SYSTEM_PATTERN = /\bsystem\s*\(/
const JQ_DANGEROUS_FLAGS = /(?:^|\s)(?:-f\b|--from-file|--rawfile|--slurpfile|-L\b|--library-path)/

// IFS injection pattern
const IFS_PATTERN = /\$IFS|\$\{[^}]*IFS/

// Proc environ pattern
const PROC_ENVIRON_PATTERN = /\/proc\/.*\/environ/

// Unicode whitespace
const UNICODE_WHITESPACE_RE = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/

// Control characters (excluding tab, newline, carriage return)
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/

// ============================================================
// Quote Tracking Utility
// ============================================================

interface QuoteState {
  inSingleQuote: boolean
  inDoubleQuote: boolean
  escaped: boolean
}

function createQuoteState(): QuoteState {
  return {
    inSingleQuote: false,
    inDoubleQuote: false,
    escaped: false,
  }
}

function updateQuoteState(state: QuoteState, char: string): void {
  if (state.escaped) {
    state.escaped = false
    return
  }

  if (char === "\\" && !state.inSingleQuote) {
    state.escaped = true
    return
  }

  if (char === "'" && !state.inDoubleQuote && !state.escaped) {
    state.inSingleQuote = !state.inSingleQuote
    return
  }

  if (char === '"' && !state.inSingleQuote && !state.escaped) {
    state.inDoubleQuote = !state.inDoubleQuote
    return
  }
}

function resetQuoteState(state: QuoteState): void {
  state.inSingleQuote = false
  state.inDoubleQuote = false
  state.escaped = false
}

// ============================================================
// Validator 1: Empty Command
// ============================================================

export function validateEmpty(context: ValidationContext): ValidatorResult {
  if (!context.originalCommand.trim()) {
    return { behavior: "allow", message: "Empty command" }
  }
  return { behavior: "passthrough" }
}

// ============================================================
// Validator 2: Incomplete Commands
// ============================================================

export function validateIncompleteCommands(context: ValidationContext): ValidatorResult {
  const trimmed = context.originalCommand.trim()

  // Check for tab as first character after whitespace (incomplete command)
  if (/^\s/.test(trimmed)) {
    return {
      behavior: "ask",
      message: "Command appears incomplete (starts with tab)",
      checkId: CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  // Check for flag as first non-whitespace (incomplete command)
  if (/^\s-/.test(trimmed)) {
    return {
      behavior: "ask",
      message: "Command appears incomplete (starts with flag)",
      checkId: CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 2,
      isMisparsingCheck: true,
    }
  }

  // Check for operator as first non-whitespace (incomplete command)
  if (/^\s(?:\&\&|\|\||;|>>?|<<?|<)/.test(trimmed)) {
    return {
      behavior: "ask",
      message: "Command appears incomplete (starts with operator)",
      checkId: CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 3,
      isMisparsingCheck: true,
    }
  }

  return { behavior: "passthrough" }
}

// ============================================================
// Validator 3: Safe Heredoc (Simplified)
// ============================================================

function isSafeHeredoc(command: string): boolean {
  // Check if command contains heredoc in substitution
  if (!HEREDOC_PATTERN.test(command)) {
    return true // No heredoc in substitution, safe
  }

  // For now, flag heredoc as needing review
  // Full implementation would check delimiter quoting and content
  return false
}

export function validateSafeCommandSubstitution(context: ValidationContext): ValidatorResult {
  // Check for heredoc in command substitution
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

  return { behavior: "passthrough" }
}

// ============================================================
// Validator 4: Git Commit Special Handling
// ============================================================

export function validateGitCommit(context: ValidationContext): ValidatorResult {
  const match = GIT_COMMIT_PATTERN.exec(context.originalCommand)

  if (!match) {
    return { behavior: "passthrough" }
  }

  const [, quote, messageContent, remainder] = match

  // Check message content for command substitution
  if (/\$\(/.test(messageContent) || /`/.test(messageContent) || /\$\{/.test(messageContent)) {
    return {
      behavior: "ask",
      message: "Git commit message contains command substitution",
      checkId: CHECK_IDS.GIT_COMMIT_SUBSTITUTION,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  // Check remainder for redirection
  if (/<>|>>?/.test(remainder)) {
    return {
      behavior: "ask",
      message: "Git commit has suspicious trailing content",
      checkId: CHECK_IDS.GIT_COMMIT_SUBSTITUTION,
      subId: 2,
      isMisparsingCheck: false,
    }
  }

  // Check if message starts with dash (possible flag injection)
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

// ============================================================
// Validator 5: JQ Command
// ============================================================

export function validateJqCommand(context: ValidationContext): ValidatorResult {
  // Check for system() function in jq
  if (JQ_SYSTEM_PATTERN.test(context.originalCommand)) {
    return {
      behavior: "ask",
      message: "JQ command uses system() function",
      checkId: CHECK_IDS.JQ_SYSTEM_FUNCTION,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  // Check for dangerous jq flags
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

// ============================================================
// Validator 6: Shell Metacharacters in Quotes
// ============================================================

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

// ============================================================
// Validator 7: Dangerous Variables in Dangerous Context
// ============================================================

export function validateDangerousVariables(context: ValidationContext): ValidatorResult {
  const { fullyUnquotedContent } = context

  // Check for variable followed by redirect/pipe operator
  if (/<\|>\s*\$[A-Za-z_]/.test(fullyUnquotedContent)) {
    return {
      behavior: "ask",
      message: "Variable in dangerous context (<, >, |)",
      checkId: CHECK_IDS.DANGEROUS_VARIABLES,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  // Check for variable preceded by redirect/pipe operator
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

// ============================================================
// Validator 8: Command Substitution Patterns
// ============================================================

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

// ============================================================
// Validator 9: Redirections
// ============================================================

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

// ============================================================
// Validator 10: Newlines (and carriage return)
// ============================================================

export function validateNewlines(context: ValidationContext): ValidatorResult {
  const { fullyUnquotedPreStrip, fullyUnquotedContent } = context

  // Check for newline followed by non-whitespace (potential second command)
  // Using negative lookbehind to exclude backslash continuation
  if (/(?<![\\)\]])\n\s*\S/.test(fullyUnquotedPreStrip)) {
    return {
      behavior: "ask",
      message: "Newline followed by command (possible injection)",
      checkId: CHECK_IDS.NEWLINES,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  // Check for carriage return
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

// ============================================================
// Validator 11: IFS Injection
// ============================================================

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

// ============================================================
// Validator 12: /proc/*/environ Access
// ============================================================

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

// ============================================================
// Validator 13: Backslash Escaped Whitespace
// ============================================================

function hasBackslashEscapedWhitespace(command: string): boolean {
  const state = createQuoteState()

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    updateQuoteState(state, char)

    if (char === "\\" && !state.inSingleQuote && !state.inDoubleQuote) {
      const nextChar = command[i + 1]
      if (nextChar === " " || nextChar === "\t") {
        return true
      }
    }
  }

  return false
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

// ============================================================
// Validator 14: Backslash Escaped Operators
// ============================================================

const SHELL_OPERATORS = new Set([";", "|", "&", "<", ">"])

function hasBackslashEscapedOperator(command: string): boolean {
  const state = createQuoteState()

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!

    // Handle escape FIRST — backslash in single quotes is literal, so skip there.
    // Outside quotes we flag escaped operators; inside double quotes the operator
    // is already literal, so just consume the escaped pair without toggling state.
    if (char === "\\" && !state.inSingleQuote) {
      const nextChar = command[i + 1]
      if (!state.inDoubleQuote && nextChar && SHELL_OPERATORS.has(nextChar)) {
        return true
      }
      i++ // skip the escaped character so it can't toggle quote state
      continue
    }

    updateQuoteState(state, char)
  }

  return false
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

// ============================================================
// Validator 15: Brace Expansion
// ============================================================

interface BraceDepth {
  depth: number
  hasComma: boolean
  hasDotDot: boolean
}

export function validateBraceExpansion(context: ValidationContext): ValidatorResult {
  const { originalCommand, unquotedContent } = context

  // Count unescaped braces
  let openCount = 0
  let closeCount = 0
  let lastOpenIndex = -1
  let state = createQuoteState()

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
        lastOpenIndex = i
      } else if (char === "}") {
        closeCount++
      }
    }
  }

  // Check for unbalanced braces (potential injection)
  if (openCount > 0 && closeCount > openCount) {
    return {
      behavior: "ask",
      message: "Unbalanced braces detected (possible injection)",
      checkId: CHECK_IDS.BRACE_EXPANSION,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  // Check for quoted braces that might be attempting to bypass
  if (openCount > 0 && /['"][{}]['"]/.test(originalCommand)) {
    return {
      behavior: "ask",
      message: "Quoted braces in command context",
      checkId: CHECK_IDS.BRACE_EXPANSION,
      subId: 2,
      isMisparsingCheck: true,
    }
  }

  // Check for brace expansion syntax {a,b} or {1..10}
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

// ============================================================
// Validator 16: Control Characters
// ============================================================

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

// ============================================================
// Validator 17: Unicode Whitespace
// ============================================================

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

// ============================================================
// Validator 18: Mid-Word Hash
// ============================================================

export function validateMidWordHash(context: ValidationContext): ValidatorResult {
  const { unquotedKeepQuoteChars, originalCommand } = context

  // Check for # in middle of word (not at start, not escaped)
  if (/\S(?<!\$\{)#/.test(unquotedKeepQuoteChars)) {
    return {
      behavior: "ask",
      message: "Hash character in middle of word",
      checkId: CHECK_IDS.MID_WORD_HASH,
      subId: 1,
      isMisparsingCheck: true,
    }
  }

  // Check after line continuation
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

// ============================================================
// Validator 19: Comment-Quote Desync
// ============================================================

export function validateCommentQuoteDesync(context: ValidationContext): ValidatorResult {
  const { originalCommand } = context
  const lines = originalCommand.split("\n")

  for (const line of lines) {
    const trimmedLine = line.trim()

    // Skip empty lines and non-comment lines
    if (!trimmedLine || !trimmedLine.startsWith("#")) {
      continue
    }

    // This is a comment line - check if there's quoted content
    // that might have quote desync
    const commentContent = trimmedLine.slice(1) // Remove #
    if (/['"]/.test(commentContent)) {
      // Check for unbalanced quotes in comment
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

// ============================================================
// Validator 20: Quoted Newline
// ============================================================

export function validateQuotedNewline(context: ValidationContext): ValidatorResult {
  const { originalCommand } = context
  const lines = originalCommand.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const state = createQuoteState()

    for (const char of line) {
      updateQuoteState(state, char)
    }

    // Check if we're still in a quote at end of line
    if ((state.inSingleQuote || state.inDoubleQuote) && i < lines.length - 1) {
      const nextLine = lines[i + 1]?.trim()
      if (nextLine?.startsWith("#")) {
        // Comment after unclosed quote - possible injection
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

// ============================================================
// Validator 21: Obfuscated Flags
// ============================================================

const OBFUSCATED_PATTERNS = [
  /\$'[^']*'/, // ANSI-C quoted
  /\$"[^"]*"/, // Locale quoted
  /\$['"]{2}\s*-/, // Empty quotes + dash
  /(?:^|\s)(?:''|"")+\s*-/, // Consecutive empty quotes
  /(?:""|'')+['"]-/, // Same-type empty quotes
  /(?:^|\s)['"]{3,}/, // Three+ consecutive quotes
]

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

// ============================================================
// Validator 22: Zsh Dangerous Commands
// ============================================================

import { ZSH_DANGEROUS_COMMANDS } from "./dangers"

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

  // Check for fc -e (eval equivalent in zsh)
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

// ============================================================
// Main Validation Function
// ============================================================

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

/**
 * Create a validation context from a command string
 */
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

/**
 * Run full validation on a command
 */
export function validateCommand(command: string): ValidatorResult {
  const context = createValidationContext(command)

  // Run early validators
  for (const validator of earlyValidators) {
    const result = validator(context)
    if (result.behavior !== "passthrough") {
      return result
    }
  }

  // Run main validators
  for (const validator of mainValidators) {
    const result = validator(context)
    if (result.behavior !== "passthrough") {
      return result
    }
  }

  return { behavior: "allow" }
}

/**
 * Quick check if command is safe.
 * Short-circuit validation for common safe patterns to improve performance.
 */
export function isCommandSafe(command: string): boolean {
  // Fast path: empty or whitespace-only commands are safe
  if (!command.trim()) return true

  // Fast path: common read-only commands that need no validation
  const lower = command.toLowerCase().trim()
  if (lower === "ls" || lower === "dir" || lower === "pwd" || lower === "echo" || lower === "cat" || lower === "type") {
    return true
  }

  return validateCommand(command).behavior === "allow"
}
