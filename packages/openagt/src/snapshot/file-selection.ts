// Stateless helpers for snapshot file list selection and exclude text.
// This file does not run Git, read the filesystem, or mutate the snapshot index.

export function splitNulList(text: string): string[] {
  return text.split("\0").filter(Boolean)
}

export function mergeCandidateFiles(tracked: string[], untracked: string[]): string[] {
  return Array.from(new Set([...tracked, ...untracked]))
}

export function filesNotIgnored(files: string[], ignored: Set<string>): string[] {
  return files.filter((item) => !ignored.has(item))
}

export function blockedLargeUntracked(untracked: string[], large: Set<string>): Set<string> {
  return new Set(untracked.filter((item) => large.has(item)))
}

export function snapshotExcludeText(source: string, list: string[] = []): string {
  return [source, ...list.map((item) => `/${item.replaceAll("\\", "/")}`)].filter(Boolean).join("\n")
}
