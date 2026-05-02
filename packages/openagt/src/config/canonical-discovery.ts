export * as ConfigCanonicalDiscovery from "./canonical-discovery"

// Canonical `.opencode/` directory naming.
//
// Historically the project's discovery globs accept both singular and plural
// forms — `.opencode/agent` AND `.opencode/agents`, `.opencode/skill` AND
// `.opencode/skills`, etc. The dual-form glob means a user who creates two
// files split across both spellings sees neither realize the other exists,
// because they're separate directories on disk.
//
// v1.21.1 (Wave 11 A7) collapses this:
//   - Both forms continue to be discovered (no hard removal yet).
//   - When a discovered file lives under the deprecated form, emit ONE
//     deprecation warning per process per (canonical, deprecated) pair.
//   - Hard removal of the deprecated form is planned for v1.23.
//
// Canonical map (matches what `.opencode/` ships on disk in this repo):
//   agent / command / mode / expert / tool   -> singular canonical
//   skill / plugin                            -> plural canonical (skills, plugins)
//
// This module exposes one helper, `warnDeprecatedConfigDir`, called from each
// loader with the canonical name, the deprecated alias, and the matched
// absolute path. Loaders themselves keep their dual-form globs unchanged.

import { Log } from "../util"

const log = Log.create({ service: "config.canonical-discovery" })
const warned = new Set<string>()

/**
 * Emit a one-time deprecation warning if the matched path lives under the
 * deprecated `.opencode/` directory name. The warning fires once per
 * (canonical, deprecated) pair per process, so a load run that discovers
 * 50 agents under `.opencode/agents/` produces exactly one warning.
 *
 * The matched path is split on both POSIX and Windows separators so
 * Windows-platform absolute paths (drive-letter + backslashes) match too.
 */
export function warnDeprecatedConfigDir(canonical: string, deprecated: string, matchedPath: string): void {
  const segments = matchedPath.split(/[\\/]/)
  if (!segments.includes(deprecated)) return
  const key = `${deprecated}->${canonical}`
  if (warned.has(key)) return
  warned.add(key)
  log.warn(
    `'.opencode/${deprecated}/' is deprecated; rename to '.opencode/${canonical}/'. ` +
      `Both forms are still discovered in v1.21.x; planned hard-removal in v1.23.`,
    { canonical, deprecated, matched: matchedPath },
  )
}

// Test seam: clears the per-process dedupe so a unit test can drive multiple
// independent scenarios. Not part of the public runtime contract.
export function _resetWarnedForTest(): void {
  warned.clear()
}

// Test seam: read-only view of the dedupe set. Used by the unit test to
// assert at-most-one-warning-per-pair without touching the log layer.
export function _warnedKeysForTest(): readonly string[] {
  return Array.from(warned)
}
