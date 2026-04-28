/**
 * Dangerous Command Detector
 *
 * Unified security detection entry point for posix shells, cmd, and PowerShell.
 */

import type { DangerSeverity } from "./danger-contracts"
import { Effect, Layer, Context } from "effect"
import type { DangerDetectorOptions, DangerResult } from "./danger-detector-contracts"
import { detectShellFamily } from "./danger-detector-shell"
import { generateSuggestions, isDetectionAllowed } from "./danger-detector-results"
import { combineDetections, detectBashDanger, detectCmdDanger, detectPowerShellDanger } from "./danger-detector-scans"

export type { DangerDetectorOptions, DangerResult, ShellFamily } from "./danger-detector-contracts"

export function detect(command: string, shell?: string, options?: DangerDetectorOptions): DangerResult {
  const shellFamily = detectShellFamily(shell)
  const detection =
    shellFamily === "powershell"
      ? detectPowerShellDanger(command)
      : shellFamily === "cmd"
        ? detectCmdDanger(command)
        : shellFamily === "posix"
          ? detectBashDanger(command)
          : combineDetections(detectBashDanger(command), detectPowerShellDanger(command), detectCmdDanger(command))

  return {
    allowed: isDetectionAllowed(detection.severity, options?.strictMode),
    severity: detection.severity,
    reasons: detection.reasons,
    suggestions: generateSuggestions(detection.reasons, detection.severity),
    shellFamily,
    matchedPatterns: detection.patterns,
  }
}

export function isAllowed(command: string, shell?: string, options?: DangerDetectorOptions): boolean {
  return detect(command, shell, options).allowed
}

export function getSeverity(command: string, shell?: string): DangerSeverity {
  return detect(command, shell).severity
}

export function explain(command: string, shell?: string): string[] {
  return detect(command, shell).reasons
}

export interface Interface {
  readonly detect: (command: string, shell?: string, options?: DangerDetectorOptions) => Effect.Effect<DangerResult>
  readonly isAllowed: (command: string, shell?: string, options?: DangerDetectorOptions) => Effect.Effect<boolean>
  readonly getSeverity: (command: string, shell?: string) => Effect.Effect<DangerSeverity>
  readonly explain: (command: string, shell?: string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DangerDetector") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const detectEff = Effect.fn("DangerDetector.detect")(function* (
      command: string,
      shell?: string,
      options?: DangerDetectorOptions,
    ) {
      return detect(command, shell, options)
    })

    const isAllowedEff = Effect.fn("DangerDetector.isAllowed")(function* (
      command: string,
      shell?: string,
      options?: DangerDetectorOptions,
    ) {
      return isAllowed(command, shell, options)
    })

    const getSeverityEff = Effect.fn("DangerDetector.getSeverity")(function* (command: string, shell?: string) {
      return getSeverity(command, shell)
    })

    const explainEff = Effect.fn("DangerDetector.explain")(function* (command: string, shell?: string) {
      return explain(command, shell)
    })

    return Service.of({
      detect: detectEff,
      isAllowed: isAllowedEff,
      getSeverity: getSeverityEff,
      explain: explainEff,
    })
  }),
)

export const defaultLayer = layer

export * as DangerDetector from "./dangerous-command-detector"
