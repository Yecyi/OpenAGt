export type Eol = "\n" | "\r\n"
export type EolStyle = "none" | "lf" | "crlf" | "mixed"

export function normalizeEol(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

export function detectEolStyle(text: string): EolStyle {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const withoutCrlf = text.replace(/\r\n/g, "")
  const bareLf = withoutCrlf.match(/\n/g)?.length ?? 0
  const bareCr = withoutCrlf.match(/\r/g)?.length ?? 0
  if (crlf > 0 && bareLf + bareCr > 0) return "mixed"
  if (crlf > 0) return "crlf"
  if (bareLf + bareCr > 0) return "lf"
  return "none"
}

export function eolForStyle(style: EolStyle): Eol {
  return style === "crlf" || style === "mixed" ? "\r\n" : "\n"
}

export function detectEol(text: string): Eol {
  return eolForStyle(detectEolStyle(text))
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
