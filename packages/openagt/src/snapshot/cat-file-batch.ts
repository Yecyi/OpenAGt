// Parses git cat-file --batch output for snapshot full diffs.
// It does not execute Git, log fallback decisions, or format file patches.
import type { SnapshotDiffRow } from "./diff-rows"

export interface SnapshotCatFileRef {
  readonly file: string
  readonly side: "before" | "after"
  readonly ref: string
}

export type SnapshotCatFileTexts = Map<string, { before: string; after: string }>

export type SnapshotCatFileParseResult =
  | { readonly ok: true; readonly map: SnapshotCatFileTexts }
  | { readonly ok: false; readonly message: string; readonly extra?: Record<string, string> }

export function catFileRefs(rows: SnapshotDiffRow[], from: string, to: string): SnapshotCatFileRef[] {
  return rows.flatMap((row) => {
    if (row.binary) return []
    if (row.status === "added") return [{ file: row.file, side: "after", ref: `${to}:${row.file}` }]
    if (row.status === "deleted") return [{ file: row.file, side: "before", ref: `${from}:${row.file}` }]
    return [
      { file: row.file, side: "before", ref: `${from}:${row.file}` },
      { file: row.file, side: "after", ref: `${to}:${row.file}` },
    ]
  })
}

export function parseCatFileBatchOutput(refs: SnapshotCatFileRef[], out: Uint8Array): SnapshotCatFileParseResult {
  const map = new Map<string, { before: string; after: string }>()
  const dec = new TextDecoder()
  let i = 0
  for (const ref of refs) {
    let end = i
    while (end < out.length && out[end] !== 10) end += 1
    if (end >= out.length) {
      return {
        ok: false,
        message: "git cat-file --batch returned a truncated header during snapshot diff, falling back to per-file git show",
      }
    }

    const head = dec.decode(out.slice(i, end))
    i = end + 1
    const hit = map.get(ref.file) ?? { before: "", after: "" }
    if (head.endsWith(" missing")) {
      map.set(ref.file, hit)
      continue
    }

    const match = head.match(/^[0-9a-f]+ blob (\d+)$/)
    if (!match) {
      return {
        ok: false,
        message:
          "git cat-file --batch returned an unexpected header during snapshot diff, falling back to per-file git show",
        extra: { head },
      }
    }

    const size = Number(match[1])
    if (!Number.isInteger(size) || size < 0 || i + size >= out.length || out[i + size] !== 10) {
      return {
        ok: false,
        message:
          "git cat-file --batch returned truncated content during snapshot diff, falling back to per-file git show",
        extra: { head },
      }
    }

    const text = dec.decode(out.slice(i, i + size))
    if (ref.side === "before") hit.before = text
    if (ref.side === "after") hit.after = text
    map.set(ref.file, hit)
    i += size + 1
  }

  if (i !== out.length) {
    return {
      ok: false,
      message: "git cat-file --batch returned trailing data during snapshot diff, falling back to per-file git show",
    }
  }

  return { ok: true, map }
}
