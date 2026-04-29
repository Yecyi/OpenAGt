// Workspace signal scanning for coordinator long-task heuristics.
// This file reads a bounded view of the current workspace; it does not build plans or run tasks.

import { isProjectDeepDiveGoal } from "@/agent/task-classifier"
import { existsSync, readdirSync } from "fs"
import path from "path"

export type WorkspaceSignals = {
  file_count: number
  package_count: number
  language_count: number
  reasons: string[]
}

const workspaceSignalCache = new Map<string, { at: number; value: WorkspaceSignals }>()
const workspaceSignalTtlMs = 30_000

function safeReaddir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true }).slice(0, 256)
  } catch {
    return []
  }
}

export function workspaceSignalsForGoal(goal: string): WorkspaceSignals {
  if (!isProjectDeepDiveGoal(goal)) {
    return { file_count: 0, package_count: 0, language_count: 0, reasons: [] }
  }
  const root = process.cwd()
  const cached = workspaceSignalCache.get(root)
  if (cached && Date.now() - cached.at < workspaceSignalTtlMs) {
    return {
      ...cached.value,
      reasons: [...cached.value.reasons, "workspace signal cache hit"],
    }
  }
  const ignored = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage", ".artifacts"])
  const extensions = new Set<string>()
  const seenPackages = { value: 0 }
  const scan = (dir: string, remaining: number): number => {
    if (remaining <= 0) return 0
    if (!existsSync(dir)) return 0
    return safeReaddir(dir).reduce((count, entry) => {
      if (count >= remaining) return count
      if (ignored.has(entry.name)) return count
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return count + scan(full, remaining - count)
      if (!entry.isFile()) return count
      if (entry.name === "package.json") seenPackages.value += 1
      const ext = path.extname(entry.name).toLowerCase()
      if (ext) extensions.add(ext)
      return count + 1
    }, 0)
  }
  const file_count = scan(root, 2_000)
  const package_count =
    seenPackages.value +
    (existsSync(path.join(root, "bun.lock")) || existsSync(path.join(root, "pnpm-lock.yaml")) ? 1 : 0)
  const language_count = extensions.size
  const value = {
    file_count,
    package_count,
    language_count,
    reasons: [
      file_count >= 100 ? `workspace has at least ${file_count} scanned files` : undefined,
      package_count >= 2 ? `workspace has ${package_count} package or lockfile markers` : undefined,
      language_count >= 4 ? `workspace has ${language_count} file extension families` : undefined,
    ].filter((item): item is string => Boolean(item)),
  }
  workspaceSignalCache.set(root, { at: Date.now(), value })
  return value
}
