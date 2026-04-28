// Parses Git worktree text output and normalizes generated names.
// It does not execute Git, touch the filesystem, or inspect process state.

export interface GitWorktreeListEntry {
  path?: string
  branch?: string
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

export function failedRemoves(...chunks: string[]): string[] {
  return chunks.filter(Boolean).flatMap((chunk) =>
    chunk
      .split("\n")
      .map((line) => line.trim())
      .flatMap((line) => {
        const match = line.match(/^warning:\s+failed to remove\s+(.+):\s+/i)
        if (!match) return []
        const value = match[1]?.trim().replace(/^['"]|['"]$/g, "")
        if (!value) return []
        return [value]
      }),
  )
}

export function parseWorktreeList(text: string): GitWorktreeListEntry[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .reduce<GitWorktreeListEntry[]>((acc, line) => {
      if (!line) return acc
      if (line.startsWith("worktree ")) {
        acc.push({ path: line.slice("worktree ".length).trim() })
        return acc
      }
      const current = acc[acc.length - 1]
      if (!current) return acc
      if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).trim()
      }
      return acc
    }, [])
}
