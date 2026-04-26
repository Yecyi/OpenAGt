import fs from "fs"
import path from "path"

export function canonicalPath(input: string) {
  const resolved = path.resolve(input)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

export function comparablePath(input: string) {
  const canonical = canonicalPath(input)
  return process.platform === "win32" ? canonical.toLowerCase() : canonical
}

export function containsCanonicalPath(base: string, candidate: string) {
  const normalizedBase = comparablePath(base)
  const normalizedCandidate = comparablePath(candidate)
  if (normalizedBase === normalizedCandidate) return true
  return normalizedCandidate.startsWith(normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep)
}
