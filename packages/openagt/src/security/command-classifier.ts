/**
 * Command Classifier
 *
 * Public facade for shell command risk classification.
 *
 * Reference: Code Reference/CC Source Code/src/tools/BashTool/bashPermissions.ts
 */

import type { DangerSeverity } from "./danger-contracts"
import { runPatternChecks } from "./command-classifier-checks"
import type { ClassificationResult } from "./command-classifier-contracts"
import { assessRiskLevel, determineRiskFromValidator } from "./command-classifier-risk"
import { EnvSanitizer } from "./env-sanitizer"
import { WrapperStripper } from "./wrapper-stripper"
import { validateCommand } from "./validators"

export type { ClassificationResult } from "./command-classifier-contracts"

export class CommandClassifier {
  private envSanitizer: EnvSanitizer
  private wrapperStripper: WrapperStripper

  constructor() {
    this.envSanitizer = new EnvSanitizer()
    this.wrapperStripper = new WrapperStripper()
  }

  classify(command: string): ClassificationResult {
    const stripped = this.wrapperStripper.strip(command)

    if (!stripped || stripped.trim().length === 0) {
      return {
        riskLevel: "safe",
        matchedPatterns: [],
        warnings: ["Empty command"],
        sanitizedCommand: stripped,
        shouldBlock: false,
        bypassable: true,
      }
    }

    const validatorResult = validateCommand(stripped)

    if (validatorResult.behavior === "ask" && validatorResult.message) {
      const patterns = validatorResult.checkId
        ? [`check_${validatorResult.checkId}${validatorResult.subId ? `_${validatorResult.subId}` : ""}`]
        : []
      const riskLevel = determineRiskFromValidator(validatorResult)

      return {
        riskLevel,
        matchedPatterns: patterns,
        warnings: [validatorResult.message],
        sanitizedCommand: stripped,
        shouldBlock: riskLevel === "high",
        bypassable: riskLevel !== "high",
        checkId: validatorResult.checkId,
        subId: validatorResult.subId,
      }
    }
    if (validatorResult.behavior === "allow" && validatorResult.message === "Safe quoted heredoc") {
      return {
        riskLevel: "safe",
        matchedPatterns: [],
        warnings: [],
        sanitizedCommand: stripped,
        shouldBlock: false,
        bypassable: true,
      }
    }

    const checks = runPatternChecks(stripped)
    const matchedPatterns: string[] = []
    const warnings: string[] = []

    for (const check of checks) {
      matchedPatterns.push(...check.matches)
      warnings.push(...check.warnings)
    }

    const riskLevel = assessRiskLevel(matchedPatterns, stripped)
    const shouldBlock = riskLevel === "high"
    const bypassable = riskLevel !== "high"

    return {
      riskLevel,
      matchedPatterns,
      warnings,
      sanitizedCommand: stripped,
      shouldBlock,
      bypassable,
    }
  }

  generateWarning(result: ClassificationResult): string {
    if (result.riskLevel === "safe") {
      return "Command appears safe"
    }

    const warningList = result.warnings.slice(0, 3)
    return `Security warning: ${warningList.join("; ")}`
  }

  shouldBlock(command: string): boolean {
    return this.classify(command).shouldBlock
  }

  getRiskLevel(command: string): DangerSeverity {
    return this.classify(command).riskLevel
  }
}

export const commandClassifier = new CommandClassifier()

export function classifyCommand(command: string): ClassificationResult {
  return commandClassifier.classify(command)
}

export function isCommandSafe(command: string): boolean {
  return commandClassifier.classify(command).riskLevel === "safe"
}
