// Risk mapping for command classifier results.
// This file converts matched checks into severity only; it does not scan commands.

import type { DangerSeverity } from "./danger-contracts"
import type { ValidatorResult } from "./validator-contracts"

export function determineRiskFromValidator(result: ValidatorResult): DangerSeverity {
  if (result.checkId === undefined) return "low"

  const highRiskChecks = [1, 8, 12, 14, 15, 21]
  if (highRiskChecks.includes(result.checkId)) {
    return "high"
  }

  const mediumRiskChecks = [4, 5, 6, 7, 11, 13, 16, 17, 18, 19, 20, 22, 23]
  if (mediumRiskChecks.includes(result.checkId)) {
    return "medium"
  }

  return "low"
}

export function assessRiskLevel(matchedPatterns: string[], command: string): DangerSeverity {
  if (matchedPatterns.length === 0) {
    return "safe"
  }

  const highRiskIndicators = [
    "command_substitution: $()",
    "command_substitution: ${}",
    "command_substitution: $|",
    "dangerous_bash: eval",
    "dangerous_bash: exec",
    "dangerous_bash: rm_recursive_force_root",
    "rm -rf",
    "dangerous_variable: LD_",
    "dangerous_variable: DYLD_",
    "newline_injection",
    "zsh_dangerous: zmodload",
    "check_1",
    "check_8",
    "check_12",
    "check_14",
    "check_15",
    "check_21",
  ]

  for (const indicator of highRiskIndicators) {
    if (matchedPatterns.some((p) => p.includes(indicator)) || command.includes(indicator)) {
      return "high"
    }
  }

  const mediumRiskIndicators = [
    "zsh_dangerous",
    "obfuscated_flag",
    "bare_shell_prefix",
    "pipe_to_interpreter",
    "dangerous_bash",
    "check_4",
    "check_5",
    "check_6",
    "check_7",
    "check_11",
    "check_13",
    "check_16",
    "check_17",
    "check_18",
    "check_19",
    "check_20",
    "check_22",
    "check_23",
  ]

  for (const indicator of mediumRiskIndicators) {
    if (matchedPatterns.some((p) => p.includes(indicator))) {
      return "medium"
    }
  }

  if (matchedPatterns.length > 0) {
    return "low"
  }

  return "safe"
}
