// File URL line-range parsing for prompt file parts.
// This module validates query parameters only; it does not read files or create message parts.

export function parseFilePartRange(url: URL): {} | { start: number; end?: number } | { error: string } {
  const start = url.searchParams.get("start")
  if (start == null) return {}
  const startLine = Number.parseInt(start, 10)
  if (Number.isNaN(startLine)) return { error: "Invalid file range: start must be an integer" }
  if (startLine < 1) return { error: "Invalid file range: start must be greater than or equal to 1" }
  const end = url.searchParams.get("end")
  if (end == null) return { start: startLine }
  const endLine = Number.parseInt(end, 10)
  if (Number.isNaN(endLine)) return { error: "Invalid file range: end must be an integer" }
  if (endLine < 1) return { error: "Invalid file range: end must be greater than or equal to 1" }
  if (endLine < startLine) return { error: "Invalid file range: end must be greater than or equal to start" }
  return { start: startLine, end: endLine }
}
