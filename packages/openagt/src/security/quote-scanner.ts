// Quote and escape scanning helpers for shell validator rules.
// This file tracks syntax state only; it does not choose validator outcomes.

import { SHELL_OPERATORS } from "./validator-patterns"

export interface QuoteState {
  inSingleQuote: boolean
  inDoubleQuote: boolean
  escaped: boolean
}

export function createQuoteState(): QuoteState {
  return {
    inSingleQuote: false,
    inDoubleQuote: false,
    escaped: false,
  }
}

export function updateQuoteState(state: QuoteState, char: string): void {
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

export function resetQuoteState(state: QuoteState): void {
  state.inSingleQuote = false
  state.inDoubleQuote = false
  state.escaped = false
}

export function hasBackslashEscapedWhitespace(command: string): boolean {
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

export function hasBackslashEscapedOperator(command: string): boolean {
  const state = createQuoteState()

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!

    // Handle escape FIRST - backslash in single quotes is literal, so skip there.
    // Outside quotes we flag escaped operators; inside double quotes the operator
    // is already literal, so just consume the escaped pair without toggling state.
    if (char === "\\" && !state.inSingleQuote) {
      const nextChar = command[i + 1]
      if (!state.inDoubleQuote && nextChar && SHELL_OPERATORS.has(nextChar)) {
        return true
      }
      i++
      continue
    }

    updateQuoteState(state, char)
  }

  return false
}
