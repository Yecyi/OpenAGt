import fs from "fs"
import path from "path"

export function windowsSandboxPathIssue(input: string, platform = process.platform) {
  if (input.includes("\0")) return "Path contains a NUL byte"
  if (platform !== "win32") return undefined
  const normalized = input.replaceAll("/", "\\").replace(/^\\\\\?\\/, "")
  const withoutDrive = normalized.replace(/^[A-Za-z]:/, "")
  if (withoutDrive.includes(":")) return "Windows alternate data stream paths are not valid sandbox grants"
  if (/(^|\\)[^\\]*~\d(?=\.|\\|$)/i.test(withoutDrive)) {
    return "Windows 8.3 short-name paths are not valid sandbox grants"
  }
  return undefined
}

export function assertSafeSandboxPath(input: string, platform = process.platform) {
  const issue = windowsSandboxPathIssue(input, platform)
  if (issue) throw new Error(issue)
}

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

export function canonicalSandboxPath(input: string) {
  assertSafeSandboxPath(input)
  return canonicalPath(input)
}

export function containsCanonicalPath(base: string, candidate: string) {
  const normalizedBase = comparablePath(base)
  const normalizedCandidate = comparablePath(candidate)
  if (normalizedBase === normalizedCandidate) return true
  return normalizedCandidate.startsWith(normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep)
}
