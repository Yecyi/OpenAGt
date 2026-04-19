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

/**
 * Wrapper stripper for removing safe command wrappers
 */
export class WrapperStripper {
  /**
   * Strip safe wrappers from a command, returning the underlying command
   */
  strip(command: string): string {
    let result = command.trim()

    for (const { pattern } of SAFE_WRAPPER_PATTERNS) {
      const before = result
      result = result.replace(pattern, "")
      if (result !== before) {
        // Successfully stripped a wrapper, continue stripping
        // Some commands may have multiple wrappers (e.g., nice timeout)
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
    const dangerousPrefixes = [
      /^rm\s+-rf/i,
      /^dd\s+/i,
      /^mkfs/i,
      /^format/i,
      /^fdisk/i,
      /^parted/i,
    ]
    return dangerousPrefixes.some((pattern) => pattern.test(stripped))
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
