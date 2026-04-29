// Parses git diff row output and formats per-file patches for snapshot diffs.
// It does not run git, read files, or apply snapshot state changes.
import { formatPatch, structuredPatch } from "diff"
import type { FileDiff } from "./index"

export type SnapshotDiffRow = {
  file: string
  status: "added" | "deleted" | "modified"
  binary: boolean
  additions: number
  deletions: number
}

export function parseNameStatus(text: string): Map<string, SnapshotDiffRow["status"]> {
  const status = new Map<string, SnapshotDiffRow["status"]>()
  for (const line of text.trim().split("\n")) {
    if (!line) continue
    const [code, file] = line.split("\t")
    if (!code || !file) continue
    status.set(file, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified")
  }
  return status
}

export function parseNumstatRows(text: string, status: Map<string, SnapshotDiffRow["status"]>): SnapshotDiffRow[] {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [adds, dels, file] = line.split("\t")
      if (!file) return []
      const binary = adds === "-" && dels === "-"
      const additions = binary ? 0 : parseInt(adds)
      const deletions = binary ? 0 : parseInt(dels)
      return [
        {
          file,
          status: status.get(file) ?? "modified",
          binary,
          additions: Number.isFinite(additions) ? additions : 0,
          deletions: Number.isFinite(deletions) ? deletions : 0,
        } satisfies SnapshotDiffRow,
      ]
    })
}

export function filterIgnoredRows(rows: SnapshotDiffRow[], ignored: Set<string>): SnapshotDiffRow[] {
  if (ignored.size === 0) return rows
  return rows.filter((row) => !ignored.has(row.file))
}

export function buildFileDiff(row: SnapshotDiffRow, before: string, after: string): FileDiff {
  return {
    file: row.file,
    patch: row.binary
      ? ""
      : formatPatch(structuredPatch(row.file, row.file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER })),
    additions: row.additions,
    deletions: row.deletions,
    status: row.status,
  }
}
