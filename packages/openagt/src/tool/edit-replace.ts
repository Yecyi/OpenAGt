// Composes edit replacement strategies and diff trimming for edit-like tools.
// It does not read or write files, ask permissions, format code, or publish events.
import { BlockAnchorReplacer } from "./edit-block-anchor-replacer"
import type { Replacer } from "./edit-replacer-contracts"
import {
  ContextAwareReplacer,
  EscapeNormalizedReplacer,
  IndentationFlexibleReplacer,
  LineTrimmedReplacer,
  MultiOccurrenceReplacer,
  SimpleReplacer,
  TrimmedBoundaryReplacer,
  WhitespaceNormalizedReplacer,
} from "./edit-normalized-replacers"

export type { Replacer } from "./edit-replacer-contracts"
export { BlockAnchorReplacer } from "./edit-block-anchor-replacer"
export {
  ContextAwareReplacer,
  EscapeNormalizedReplacer,
  IndentationFlexibleReplacer,
  LineTrimmedReplacer,
  MultiOccurrenceReplacer,
  SimpleReplacer,
  TrimmedBoundaryReplacer,
  WhitespaceNormalizedReplacer,
} from "./edit-normalized-replacers"

const REPLACERS: Replacer[] = [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
  ContextAwareReplacer,
  MultiOccurrenceReplacer,
]

export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  let notFound = true
  let foundMultiple = false

  const matches: string[] = []

  for (const replacer of REPLACERS) {
    for (const search of replacer(content, oldString)) {
      matches.push(search)
    }
  }

  const uniqueMatches = [...new Set(matches)]

  for (const search of uniqueMatches) {
    const index = content.indexOf(search)
    if (index === -1) continue
    notFound = false
    if (replaceAll) {
      return content.replaceAll(search, newString)
    }
    const lastIndex = content.lastIndexOf(search)
    if (index !== lastIndex) {
      foundMultiple = true
      continue
    }
    return content.substring(0, index) + newString + content.substring(index + search.length)
  }

  if (notFound) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    )
  }
  throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.")
}
