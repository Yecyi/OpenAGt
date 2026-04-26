/**
 * Safe Wrapper Stripper
 *
 * Strips safe command wrappers (like timeout, nice, nohup) from commands
 * to get the underlying command for security analysis.
 *
 * Reference: Code Reference/CC Source Code/src/tools/BashTool/bashPermissions.ts
 */

// Safe wrapper patterns - these are legitimate command wrappers that
// modify command behavior but don't introduce security risks
const SAFE_WRAPPER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  // timeout: GNU timeout with various options
  // Matches: timeout [OPTIONS] DURATION COMMAND
  {
    name: "timeout",
    pattern:
      /^timeout\s+(?:--?(?:foreground|preserve-status|verbose|help|version|signal|kill-after)|--\d+|--kill-after=\d+|--signal=\S+|\d+(?:\.\d+)?[smhd]?)*\s+/i,
  },
  // time: measure command execution time
  // Matches: time [OPTIONS] COMMAND
  { name: "time", pattern: /^time\s+--?\s*/i },
  // nice: run command with modified scheduling priority
  // Matches: nice [OPTIONS] COMMAND
  {
    name: "nice",
    pattern: /^nice\s+(?:-n\s+-?\d+|\s+-\d+)?\s*(?:--\s*)?/i,
  },
  // stdbuf: modify standard IO buffering
  // Matches: stdbuf [OPTIONS] COMMAND
  { name: "stdbuf", pattern: /^stdbuf\s+-[ioe][LN0-9]+\s*(?:--\s*)?/i },
  // nohup: run command immune to hangups
  // Matches: nohup [OPTIONS] COMMAND
  { name: "nohup", pattern: /^nohup\s+--?\s*/i },
]

// env wrapper: only allow VAR=VALUE assignments with no shell metacharacters
// Refuse to strip env -i (resets all environment variables)
const ENV_SAFE_PATTERN = /^(?:env\s+)([A-Za-z_][A-Za-z0-9_]*=[^\s;&|`$<>{}()\[\]]+\s*)+/
const ENV_DANGEROUS_PATTERN = /^env\s+(-i|--ignore-environment)\b/

const SHELL_METACHAR_PATTERN = /[;&|`$<>{}()\[\]\\!*?"'#%@]/

// Dangerous one-liner patterns for additional detection
const DANGEROUS_ONELINER_PATTERNS: Array<{ pattern: RegExp; name: string; reason: string }> = [
  // curl/wget pipe to shell
  { pattern: /curl\s+.*\|\s*(?:sh|bash|ksh|zsh|fish)/i, name: "curl-pipe-sh", reason: "curl piped to shell execution" },
  { pattern: /wget\s+.*\|\s*(?:sh|bash|ksh|zsh|fish)/i, name: "wget-pipe-sh", reason: "wget piped to shell execution" },
  // tar extraction with execution
  {
    pattern: /tar\s+.*[-][xc]f\s+.*\|\s*(?:sh|bash|perl|python)/i,
    name: "tar-pipe-sh",
    reason: "tar extraction piped to shell",
  },
  // dd with execution
  { pattern: /dd\s+.*\|\s*(?:sh|bash|ksh|zsh)/i, name: "dd-pipe-sh", reason: "dd piped to shell execution" },
  // cat with execution
  { pattern: /cat\s+.*\|\s*(?:sh|bash|ksh|zsh)/i, name: "cat-pipe-sh", reason: "cat piped to shell execution" },
  // python/perl one-liners with -c execution
  {
    pattern: /(?:python|perl|ruby|php|node)\s+-[rc]\s+/i,
    name: "interpreter-c-flag",
    reason: "Interpreter with -c flag can execute arbitrary code",
  },
  // base64 decode and execute
  {
    pattern: /base64\s+(-d|--decode).*\|\s*(?:sh|bash|ksh|zsh)/i,
    name: "base64-pipe-sh",
    reason: "base64 decode piped to shell",
  },
]

/**
 * Wrapper stripper for removing safe command wrappers
 */
export class WrapperStripper {
  /**
   * Strip safe wrappers from a command, returning the underlying command
   */
  strip(command: string): string {
    let result = command.trim()

    // Check for dangerous env -i first
    if (ENV_DANGEROUS_PATTERN.test(result)) {
      return result.trim()
    }

    // Check for safe env VAR=VALUE pattern
    const envMatch = result.match(/^(env\s+)(.+)/i)
    if (envMatch) {
      const [, envPrefix, envArgs] = envMatch
      // Only strip if all env arguments are VAR=VALUE with no shell metacharacters
      const vars = envArgs.trim().split(/\s+/)
      const allSafe = vars.every((v) => {
        if (v.includes("=")) {
          const [key] = v.split("=")
          return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !SHELL_METACHAR_PATTERN.test(v)
        }
        return false
      })
      if (allSafe) {
        result = result.replace(envMatch[0], "").trim()
      }
    }

    for (const { pattern } of SAFE_WRAPPER_PATTERNS) {
      const before = result
      result = result.replace(pattern, "")
      if (result !== before) {
        continue
      }
    }

    return result.trim()
  }

  /**
   * Check if a command has any safe wrappers
   */
  isWrapped(command: string): boolean {
    return SAFE_WRAPPER_PATTERNS.some(({ pattern }) => pattern.test(command))
  }

  /**
   * Get the names of wrappers that would be stripped from a command
   */
  getWrapperNames(command: string): string[] {
    const names: string[] = []
    for (const { pattern, name } of SAFE_WRAPPER_PATTERNS) {
      if (pattern.test(command)) {
        names.push(name)
      }
    }
    return names
  }

  /**
   * Get detailed wrapper information including the matched portions
   */
  getWrapperInfo(command: string): Array<{ name: string; matched: string }> {
    const info: Array<{ name: string; matched: string }> = []

    for (const { pattern, name } of SAFE_WRAPPER_PATTERNS) {
      const match = command.match(pattern)
      if (match) {
        info.push({ name, matched: match[0] })
      }
    }

    return info
  }

  /**
   * Recursively strip all wrappers (commands can have multiple wrappers)
   */
  stripAll(command: string): string {
    let result = command.trim()
    let iterations = 0
    const maxIterations = 5 // Safety limit

    while (iterations < maxIterations) {
      const before = result
      for (const { pattern } of SAFE_WRAPPER_PATTERNS) {
        result = result.replace(pattern, "")
      }
      if (result === before) {
        // No more wrappers to strip
        break
      }
      iterations++
    }

    return result.trim()
  }

  /**
   * Check if a command would become dangerous after stripping wrappers
   * This helps detect attacks like "nice rm -rf /"
   */
  becomesDangerousAfterStrip(command: string): boolean {
    const stripped = this.strip(command)
    // Check if the stripped command starts with a dangerous pattern
    const dangerousPrefixes = [/^rm\s+-rf/i, /^dd\s+/i, /^mkfs/i, /^format/i, /^fdisk/i, /^parted/i]
    return dangerousPrefixes.some((pattern) => pattern.test(stripped))
  }

  /**
   * Detect dangerous one-liner patterns that could be security risks
   * Returns array of detected dangerous patterns or empty array if safe
   */
  detectDangerousOneliners(command: string): Array<{ name: string; reason: string }> {
    const detected: Array<{ name: string; reason: string }> = []
    for (const { pattern, name, reason } of DANGEROUS_ONELINER_PATTERNS) {
      if (pattern.test(command)) {
        detected.push({ name, reason })
      }
    }
    return detected
  }
}

/**
 * Singleton instance for convenience
 */
export const wrapperStripper = new WrapperStripper()

/**
 * Strip wrappers from a command
 */
export function stripWrappers(command: string): string {
  return wrapperStripper.strip(command)
}
