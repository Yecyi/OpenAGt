import { Effect } from "effect"

export interface InjectionPattern {
  pattern: RegExp
  severity: "low" | "medium" | "high"
  description: string
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    pattern: /\u200b|\u200c|\u200d|\ufeff/,
    severity: "high",
    description: "Invisible unicode characters (zero-width space, etc.)",
  },
  {
    pattern: /ignore previous instructions?/i,
    severity: "high",
    description: "Classic prompt injection phrase",
  },
  {
    pattern: /disregard (?:all )?(?:previous|prior) (?:instructions?|commands?|rules?)/i,
    severity: "high",
    description: "Instruction override attempt",
  },
  {
    pattern: /forget (?:all )?(?:previous|prior) (?:instructions?|commands?)/i,
    severity: "high",
    description: "Forget previous instructions attempt",
  },
  {
    pattern: /you (?:are now|have become|must act as) a(?:n)? (?:different|new|other)/i,
    severity: "medium",
    description: "Role/play override attempt",
  },
  {
    pattern: /<[^>]*hidden|visibility\s*:\s*hidden|display\s*:\s*none/i,
    severity: "medium",
    description: "Hidden HTML elements",
  },
  {
    pattern: /<!--[\s\S]*?-->/,
    severity: "low",
    description: "HTML comments (may contain hidden instructions)",
  },
  {
    pattern: /\[\[|\]\]|role\s*:\s*system/,
    severity: "medium",
    description: "Wiki/JSON injection markers",
  },
  {
    pattern: /\x00|\x1a/,
    severity: "high",
    description: "Control characters",
  },
  {
    pattern: /(?:api|secret|key|password|token)\s*[:=]\s*['"]?[a-zA-Z0-9_-]{20,}/i,
    severity: "high",
    description: "Potential credential exfiltration pattern",
  },
]

export interface ScanResult {
  clean: boolean
  issues: Array<{
    pattern: string
    severity: "low" | "medium" | "high"
    description: string
    match: string
    position: number
  }>
}

/**
 * Pre-compiled regex patterns for scanForInjection.
 * Compiled once at module load time instead of per-call.
 */
const COMPILED_PATTERNS = INJECTION_PATTERNS.map(({ pattern, severity, description }) => ({
  regex: new RegExp(pattern.source, pattern.flags),
  severity,
  description,
}))

export function scanForInjection(content: string): ScanResult {
  const issues: ScanResult["issues"] = []

  for (const { regex, severity, description } of COMPILED_PATTERNS) {
    let match: RegExpExecArray | null

    while ((match = regex.exec(content)) !== null) {
      issues.push({
        pattern: regex.source,
        severity,
        description,
        match: match[0],
        position: match.index,
      })

      if (issues.length >= 10) break
    }
  }

  issues.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.severity] - order[b.severity]
  })

  return {
    clean: issues.length === 0,
    issues: issues.slice(0, 10),
  }
}

export function sanitizeContent(content: string): { sanitized: string; removed: number } {
  let sanitized = content
  let removed = 0

  for (const { pattern } of INJECTION_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g")
    const before = sanitized.length
    sanitized = sanitized.replace(global, "")
    removed += before - sanitized.length
  }

  return { sanitized, removed }
}

export function checkFileSafe(filePath: string, content: string): Effect.Effect<ScanResult> {
  return Effect.succeed(scanForInjection(content))
}

export const HIGH_SEVERITY_PATTERNS = INJECTION_PATTERNS.filter((p) => p.severity === "high")
export const BLOCKING_SEVERITY: Array<"low" | "medium" | "high"> = ["high", "medium"]
