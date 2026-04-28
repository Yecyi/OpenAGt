// Helper predicates for dangerous command patterns.
// This file does not own pattern data or execute shell analysis pipelines.

import {
  BARE_SHELL_PREFIXES,
  CONTROL_CHAR_RE,
  DANGEROUS_BASH_PATTERNS,
  NEWLINE_RE,
  UNICODE_WHITESPACE_RE,
  ZSH_DANGEROUS_COMMANDS,
} from "./danger-patterns"

export function hasBareShellPrefix(command: string): boolean {
  const firstToken = command.trim().split(/\s+/)[0]
  return BARE_SHELL_PREFIXES.has(firstToken)
}

export function hasControlCharacters(input: string): boolean {
  return CONTROL_CHAR_RE.test(input)
}

export function hasUnicodeWhitespace(input: string): boolean {
  return UNICODE_WHITESPACE_RE.test(input)
}

export function hasNewlines(input: string): boolean {
  return NEWLINE_RE.test(input)
}

export function containsDangerousPatterns(command: string): boolean {
  const lowerCommand = command.toLowerCase()
  return DANGEROUS_BASH_PATTERNS.some((pattern) => lowerCommand.includes(pattern))
}

export function hasZshDangerousCommand(tokens: string[]): string | null {
  for (const token of tokens) {
    if (ZSH_DANGEROUS_COMMANDS.has(token)) {
      return token
    }
  }
  return null
}
