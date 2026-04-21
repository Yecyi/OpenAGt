import path from "path"

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
      for (const [, v] of Object.entries(value)) {
        extract(v)
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
