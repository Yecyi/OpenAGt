/**
 * Environment Variable Sanitizer
 *
 * Sanitizes environment variables for safe command execution.
 * Based on CC Source Code's bashPermissions.ts environment variable handling.
 *
 * Reference: Code Reference/CC Source Code/src/tools/BashTool/bashPermissions.ts
 */

import { SAFE_ENV_VARS, BINARY_HIJACK_VARS, ANT_ONLY_SAFE_ENV_VARS } from "./dangers"

/**
 * Environment variable sanitizer for removing dangerous variables
 */
export class EnvSanitizer {
  private readonly env: Record<string, string | undefined>
  private readonly isAntContext: boolean

  constructor(env: Record<string, string | undefined> = process.env) {
    this.env = env
    this.isAntContext = process.env?.USER_TYPE === "ant"
  }

  /**
   * Check if an environment variable key is safe to pass through
   */
  isSafeEnvVar(key: string): boolean {
    // Check whitelist
    if (SAFE_ENV_VARS.has(key)) return true

    // Check ANT-specific whitelist
    if (this.isAntContext && ANT_ONLY_SAFE_ENV_VARS.has(key)) return true

    // Check against binary hijack patterns (LD_*, DYLD_*, PATH)
    if (BINARY_HIJACK_VARS.test(key)) return false

    // Default: not safe
    return false
  }

  /**
   * Sanitize environment variables, returning only safe ones
   */
  sanitize(): Record<string, string> {
    const sanitized: Record<string, string> = {}
    for (const [key, value] of Object.entries(this.env)) {
      if (this.isSafeEnvVar(key)) {
        sanitized[key] = value
      }
    }
    return sanitized
  }

  /**
   * Get list of safe environment variable keys for logging/debugging
   */
  getSafeEnvKeys(): string[] {
    return Object.keys(this.env).filter((k) => this.isSafeEnvVar(k))
  }

  /**
   * Get list of blocked environment variable keys for logging/debugging
   */
  getBlockedEnvKeys(): string[] {
    return Object.keys(this.env).filter((k) => !this.isSafeEnvVar(k))
  }

  /**
   * Get environment variables for logging (without sensitive values)
   */
  getSafeEnvForLog(): string[] {
    return this.getSafeEnvKeys()
  }

  /**
   * Check if an environment variable would be blocked
   */
  wouldBlock(key: string): boolean {
    return !this.isSafeEnvVar(key)
  }

  /**
   * Get all dangerous environment variables that would be blocked
   */
  getDangerousVars(): Array<{ key: string; reason: string }> {
    const dangerous: Array<{ key: string; reason: string }> = []

    for (const key of Object.keys(this.env)) {
      if (!this.isSafeEnvVar(key)) {
        if (BINARY_HIJACK_VARS.test(key)) {
          dangerous.push({
            key,
            reason: `binary hijack variable (${key})`,
          })
        } else {
          dangerous.push({
            key,
            reason: "not in whitelist",
          })
        }
      }
    }

    return dangerous
  }
}

/**
 * Create a sanitized environment object for subprocess execution
 */
export function createSanitizedEnv(
  baseEnv: Record<string, string> = process.env as Record<string, string>,
): Record<string, string> {
  const sanitizer = new EnvSanitizer(baseEnv)
  return sanitizer.sanitize()
}

/**
 * Check if a specific environment variable is safe
 */
export function isEnvVarSafe(key: string): boolean {
  const sanitizer = new EnvSanitizer()
  return sanitizer.isSafeEnvVar(key)
}
