// Config-to-ruleset conversion and permission disablement helpers.
// This file only normalizes in-memory rules; it does not ask users or persist approvals.

import { ConfigPermission } from "@/config/permission"
import { Log, Wildcard } from "@/util"
import os from "os"
import type { Ruleset } from "./contracts"

const log = Log.create({ service: "permission" })

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermission.Info): Ruleset {
  const ruleset: Ruleset = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      const validation = validatePattern("*")
      if (!validation.valid) {
        log.warn("permission_pattern_validation", { pattern: "*", warning: validation.message })
      }
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    for (const [pattern, action] of Object.entries(value)) {
      const validation = validatePattern(pattern)
      if (!validation.valid) {
        log.warn("permission_pattern_validation", { pattern, warning: validation.message })
      }
      ruleset.push({ permission: key, pattern: expand(pattern), action })
    }
  }
  return ruleset
}

function validatePattern(pattern: string): { valid: boolean; message?: string } {
  if (pattern === "*") {
    return {
      valid: false,
      message: "Bare '*' pattern is too permissive. Use specific patterns like 'npm *' or 'git *'.",
    }
  }

  if (pattern.includes("**") && !pattern.startsWith("**") && !pattern.endsWith("**")) {
    return { valid: false, message: "Pattern '**' must be anchored (start or end of pattern)." }
  }

  const starIndex = pattern.indexOf("*")
  if (starIndex > 0) {
    const beforeStar = pattern.slice(0, starIndex)
    if (!/[a-zA-Z0-9]/.test(beforeStar)) {
      return {
        valid: false,
        message: "Pattern must have at least one literal character before '*'. For example: 'npm *' not '*install'.",
      }
    }
  }

  if (pattern.endsWith("**") && !pattern.endsWith("/**")) {
    return {
      valid: false,
      message: "Pattern ending with '**' should be '/**' for directory matching.",
    }
  }

  return { valid: true }
}

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

const EDIT_TOOLS = ["edit", "write", "apply_patch", "multiedit"]

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
    if (!rule) continue
    if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
  }
  return result
}
