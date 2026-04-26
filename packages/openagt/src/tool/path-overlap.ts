import path from "path"

/**
 * Bash commands that operate on paths
 */
const PATH_CMD_PATTERN = /^(cd|cp|mv|rm|rmdir|mkdir|chmod|chown|touch|cat|head|tail|grep|find)\b/i

/**
 * Extract paths from a string that may contain quoted paths
 */
function extractQuotedPaths(text: string): string[] {
  const paths: string[] = []
  const patterns = [/"([^"\\]|\\.)*"/g, /'([^'\\]|\\.)*'/g]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      let content = match[0]!.slice(1, -1)
      content = content.replace(/\\"/g, '"').replace(/\\'/g, "'")
      if (content.trim()) {
        paths.push(content.trim())
      }
    }
  }

  return paths
}

/**
 * Extract paths from a Bash command string
 */
function extractFromBashCommand(command: string): string[] {
  const paths: string[] = []
  const trimmed = command.trim()

  const match = trimmed.match(PATH_CMD_PATTERN)
  if (!match) return paths

  const cmd = match[1]!.toLowerCase()
  const args = trimmed.slice(match[0].length).trim()

  if (cmd === "cd" || cmd === "mkdir") {
    const parts = args.split(/\s+/)
    for (const part of parts) {
      if (part && !part.startsWith("-") && !part.includes("=")) {
        paths.push(...extractQuotedPaths(part))
      }
    }
  } else if (cmd === "cp" || cmd === "mv") {
    const quotedPaths = extractQuotedPaths(args)
    paths.push(...quotedPaths)
    const unquotedParts = args.split(/\s+/)
    for (const part of unquotedParts) {
      if (part && !part.startsWith("-") && !part.includes("=") && (part.includes("/") || part.includes("\\"))) {
        paths.push(part)
      }
    }
  } else if (cmd === "rm" || cmd === "rmdir") {
    const parts = args.split(/\s+/)
    for (const part of parts) {
      if (!part || part.startsWith("-")) continue
      paths.push(...extractQuotedPaths(part))
    }
  } else if (cmd === "touch" || cmd === "cat" || cmd === "head" || cmd === "tail" || cmd === "grep") {
    const quotedPaths = extractQuotedPaths(args)
    paths.push(...quotedPaths)
  }

  return paths
}

/**
 * Extract directory prefix from a glob pattern
 */
function extractGlobPrefix(pattern: string): string | null {
  const parts = pattern.split(/[*?[\]]/)
  if (parts.length > 0 && parts[0]) {
    return parts[0]
  }
  return null
}

export function extractPathsFromInput(input: Record<string, unknown>): string[] {
  const paths: string[] = []

  function extract(value: unknown): void {
    if (typeof value === "string") {
      if (
        !value.startsWith("-") &&
        !value.startsWith(".") &&
        !value.includes("=") &&
        (value.includes("/") || value.includes("\\") || value.includes("."))
      ) {
        paths.push(value)
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        extract(item)
      }
    } else if (typeof value === "object" && value !== null) {
      for (const [key, v] of Object.entries(value)) {
        if (key === "command" && typeof v === "string") {
          paths.push(...extractFromBashCommand(v))
        } else if (key === "pattern" && typeof v === "string") {
          const prefix = extractGlobPrefix(v)
          if (prefix) paths.push(prefix)
        } else if (key === "patterns" && Array.isArray(v)) {
          for (const p of v) {
            if (typeof p === "string") {
              const prefix = extractGlobPrefix(p)
              if (prefix) paths.push(prefix)
            }
          }
        } else {
          extract(v)
        }
      }
    }
  }

  extract(input)
  return paths.filter((p) => p.length > 0 && !p.startsWith("-"))
}

export function pathsOverlap(paths1: string[], paths2: string[]): boolean {
  const normalized1 = paths1.map((p) => path.normalize(p).toLowerCase())
  const normalized2 = paths2.map((p) => path.normalize(p).toLowerCase())

  for (const p1 of normalized1) {
    for (const p2 of normalized2) {
      if (p1 === p2) return true
      const dir1 = path.dirname(p1)
      const dir2 = path.dirname(p2)
      if (dir1 === dir2 && dir1 !== ".") return true
      if (p1.startsWith(p2) || p2.startsWith(p1)) return true
    }
  }

  return false
}

export function detectPathConflicts(
  calls: Array<{ toolName: string; input: Record<string, unknown> }>,
): Array<{ call1: number; call2: number; reason: string }> {
  const conflicts: Array<{ call1: number; call2: number; reason: string }> = []

  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      const paths1 = extractPathsFromInput(calls[i].input)
      const paths2 = extractPathsFromInput(calls[j].input)

      if (pathsOverlap(paths1, paths2)) {
        conflicts.push({
          call1: i,
          call2: j,
          reason: `Path overlap: ${paths1.join(", ")} vs ${paths2.join(", ")}`,
        })
      }
    }
  }

  return conflicts
}
