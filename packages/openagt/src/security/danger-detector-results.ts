// Result formatting for dangerous command detection.
// This file derives allowed/suggestions from reasons and severity; it does not scan commands.

import type { DangerSeverity } from "./danger-contracts"

export function isDetectionAllowed(severity: DangerSeverity, strictMode?: boolean): boolean {
  return severity === "high" ? false : severity === "medium" ? !strictMode : true
}

export function generateSuggestions(reasons: string[], severity: DangerSeverity): string[] {
  const suggestions: string[] = []

  if (severity === "high") {
    suggestions.push("Review the command manually before execution")
    suggestions.push("Consider breaking the command into smaller, safer operations")
  }

  if (reasons.some((reason) => reason.includes("Pipe to shell"))) {
    suggestions.push("Download script first, review content, then execute")
    suggestions.push("Use --download-only flag if available")
  }

  if (reasons.some((reason) => reason.includes("control characters") || reason.includes("unicode"))) {
    suggestions.push("Remove unexpected characters from the command")
  }

  if (reasons.some((reason) => reason.toLowerCase().includes("encoded"))) {
    suggestions.push("Use decoded command for transparency")
  }

  if (reasons.some((reason) => /rundll32|regsvr32|mshta/i.test(reason))) {
    suggestions.push("This is a 'living off the land' technique often used by malware")
    suggestions.push("Ensure the DLL or script source is trusted")
  }

  return suggestions
}
