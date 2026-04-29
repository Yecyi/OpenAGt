// Supplemental PowerShell obfuscation heuristics layered on top of AST parsing.
// This file does not tokenize commands or emit dangerous AST nodes.

import { expandAliases } from "./powershell-ast-patterns"
import type { ObfuscationReport } from "./powershell-ast-contracts"

function tryDecodeBase64(input: string): { decoded: string | null; depth: number } {
  let current = input
  let depth = 0
  const maxDepth = 3

  while (depth < maxDepth) {
    const trimmed = current.trim()
    if (!/^[A-Za-z0-9+/=]+$/.test(trimmed) || trimmed.length < 4) {
      break
    }
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf-8")
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded)) break
      const nextDecoded = decoded.replace(/[\r\n]+/g, " ").trim()
      if (nextDecoded.length < 4) break
      current = nextDecoded
      depth++
    } catch {
      break
    }
  }

  return depth > 0 ? { decoded: current, depth } : { decoded: null, depth: 0 }
}

function detectIndirectCalls(input: string): string[] {
  const detected: string[] = []
  const indirectPattern = /\$\w+\s*=\s*["'][^"']+["']\s*;?\s*&\s*\$/g
  let match
  while ((match = indirectPattern.exec(input)) !== null) {
    detected.push(match[0]!)
  }

  const variableCallPattern = /\$[a-zA-Z_]\w*\s*=\s*"([^"]+)"\s*;?\s*&\s*\$[a-zA-Z_]\w*/gi
  while ((match = variableCallPattern.exec(input)) !== null) {
    detected.push(match[0]!)
  }

  return detected
}

export function analyzeObfuscation(input: string): ObfuscationReport {
  const aliasesExpanded: string[] = []
  const indirectCalls = detectIndirectCalls(input)

  const words = input.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []
  for (const word of words) {
    const expanded = expandAliases(word)
    if (expanded !== word) {
      aliasesExpanded.push(`${word} -> ${expanded}`)
    }
  }

  const base64Pattern = /-enc(?:odedCommand)?\s+([A-Za-z0-9+/=]+)/i
  const base64Match = base64Pattern.exec(input)
  let base64Decoded: string | undefined
  let base64Attempts = 0

  if (base64Match) {
    base64Attempts++
    const decoded = tryDecodeBase64(base64Match[1]!)
    if (decoded.decoded) {
      base64Decoded = decoded.decoded
    }
  }

  const b64InSubexpr = input.match(/\$\(([^)]+)\)/g)
  if (b64InSubexpr) {
    for (const subexpr of b64InSubexpr) {
      if (/FromBase64String/i.test(subexpr)) {
        base64Attempts++
        const inner = subexpr.match(/\$?\(([^)]+)\)/)?.[1]
        if (inner) {
          const decoded = tryDecodeBase64(inner)
          if (decoded.decoded) {
            base64Decoded = decoded.decoded
          }
        }
      }
    }
  }

  let overallRisk: "low" | "medium" | "high" = "low"
  if (indirectCalls.length > 0) {
    overallRisk = "high"
  } else if (base64Attempts > 0 && base64Decoded && base64Decoded.length >= 4) {
    overallRisk = "high"
  } else if (aliasesExpanded.length > 3) {
    overallRisk = "medium"
  }

  return {
    aliasesExpanded,
    indirectCallsDetected: indirectCalls,
    base64Attempts,
    base64Decoded,
    overallRisk,
  }
}
