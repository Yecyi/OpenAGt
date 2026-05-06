export type Eol = "\n" | "\r\n"

export function normalizeEol(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

export function detectEol(text: string): Eol {
  if (text.includes("\r\n")) return "\r\n"
  return "\n"
}

export function splitLinesForPatch(text: string) {
  const normalized = normalizeEol(text)
  if (normalized.length === 0) {
    return {
      lines: [] as string[],
      eol: detectEol(text),
    }
  }
  const lines = normalized.split("\n")
  if (normalized.endsWith("\n")) lines.pop()
  return {
    lines,
    eol: detectEol(text),
  }
}

export function joinLinesWithEol(lines: string[], eol: Eol, trailing = true) {
  if (lines.length === 0) return ""
  return `${lines.join(eol)}${trailing ? eol : ""}`
}

export function truncateCodePoints(text: string, max: number, suffix = "") {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return `${chars.slice(0, max).join("")}${suffix}`
}
