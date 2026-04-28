/**
 * Command Classifier
 *
 * Classifies shell commands based on security risk level by analyzing
 * command substitution, dangerous patterns, obfuscation techniques, and other
 * security-relevant characteristics.
 *
 * Reference: Code Reference/CC Source Code/src/tools/BashTool/bashPermissions.ts
 */

import {
  COMMAND_SUBSTITUTION_PATTERNS,
  ZSH_DANGEROUS_COMMANDS,
  DANGEROUS_BASH_PATTERNS,
  OBFUSCATED_FLAG_PATTERNS,
  BARE_SHELL_PREFIXES,
  BINARY_HIJACK_VARS,
  hasControlCharacters,
  hasUnicodeWhitespace,
  hasNewlines,
} from "./dangers"
import type { DangerSeverity } from "./dangers"
import { EnvSanitizer } from "./env-sanitizer"
import { WrapperStripper } from "./wrapper-stripper"
import { validateCommand } from "./validators"

// ============================================================
// Types
// ============================================================

export interface ClassificationResult {
  riskLevel: DangerSeverity
  matchedPatterns: string[]
  warnings: string[]
  sanitizedCommand: string
  shouldBlock: boolean
  bypassable: boolean
  checkId?: number
  subId?: number
}

const DESTRUCTIVE_RM_PATTERN = /\brm\b(?=[^;&|]*\s-[^\s;&|]*r)(?=[^;&|]*\s-[^\s;&|]*f)[^;&|]*(?:^|\s)(?:\/|\*|~)(?:\s|$)/i

// ============================================================
// Command Classifier
// ============================================================

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

    // Run CC-style validation
    const validatorResult = validateCommand(stripped)

    if (validatorResult.behavior === "ask" && validatorResult.message) {
      const patterns = validatorResult.checkId
        ? [`check_${validatorResult.checkId}${validatorResult.subId ? `_${validatorResult.subId}` : ""}`]
        : []
      const riskLevel = this.determineRiskFromValidator(validatorResult)

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

    // Additional pattern checks
    const checks = [
      this.checkCommandSubstitution(stripped),
      this.checkDangerousVariables(stripped),
      this.checkZshDangerous(stripped),
      this.checkDangerousBash(stripped),
      this.checkObfuscatedFlags(stripped),
      this.checkBareShellPrefixes(stripped),
      this.checkControlCharacters(stripped),
      this.checkUnicodeWhitespace(stripped),
      this.checkNewlines(stripped),
      this.checkDangerousRedirections(stripped),
      this.checkIFSInjection(stripped),
      this.checkProcEnviron(stripped),
    ]

    const matchedPatterns: string[] = []
    const warnings: string[] = []

    for (const check of checks) {
      matchedPatterns.push(...check.matches)
      warnings.push(...check.warnings)
    }

    const riskLevel = this.assessRiskLevel(matchedPatterns, stripped)
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

  private determineRiskFromValidator(result: ReturnType<typeof validateCommand>): DangerSeverity {
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

  private checkCommandSubstitution(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []

    for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
      if (pattern.test(cmd)) {
        matches.push(`command_substitution: ${message}`)
        warnings.push(`Command substitution detected: ${message}`)
      }
    }

    return { matches, warnings }
  }

  private checkDangerousVariables(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []

    const envVarPattern = /\b([A-Za-z_][A-Za-z0-9_]*)=(.*)/g
    let match

    while ((match = envVarPattern.exec(cmd)) !== null) {
      const [, varName] = match
      if (BINARY_HIJACK_VARS.test(varName)) {
        matches.push(`dangerous_variable: ${varName}`)
        warnings.push(`Dangerous environment variable assignment: ${varName}`)
      }
    }

    if (BINARY_HIJACK_VARS.test(cmd)) {
      matches.push("contains_dangerous_variable_reference")
      warnings.push("Command contains reference to dangerous environment variable")
    }

    return { matches, warnings }
  }

  private checkZshDangerous(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []
    const tokens = cmd.split(/\s+/)

    for (const token of tokens) {
      if (ZSH_DANGEROUS_COMMANDS.has(token)) {
        matches.push(`zsh_dangerous: ${token}`)
        warnings.push(`Zsh dangerous command detected: ${token}`)
      }
    }

    return { matches, warnings }
  }

  private checkDangerousBash(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []
    const lowerCmd = cmd.toLowerCase()

    for (const pattern of DANGEROUS_BASH_PATTERNS) {
      if (lowerCmd.includes(pattern)) {
        matches.push(`dangerous_bash: ${pattern}`)
        warnings.push(`Dangerous bash pattern detected: ${pattern}`)
      }
    }
    if (DESTRUCTIVE_RM_PATTERN.test(cmd)) {
      matches.push("dangerous_bash: rm_recursive_force_root")
      warnings.push("Dangerous recursive delete pattern")
    }

    return { matches, warnings }
  }

  private checkObfuscatedFlags(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []

    for (const { pattern, message } of OBFUSCATED_FLAG_PATTERNS) {
      if (pattern.test(cmd)) {
        matches.push(`obfuscated_flag: ${message}`)
        warnings.push(`Obfuscated flag detected: ${message}`)
      }
    }

    return { matches, warnings }
  }

  private checkBareShellPrefixes(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []
    const firstToken = cmd.trim().split(/\s+/)[0]

    if (BARE_SHELL_PREFIXES.has(firstToken)) {
      matches.push(`bare_shell_prefix: ${firstToken}`)
      warnings.push(`Bare shell prefix detected: ${firstToken}`)
    }

    return { matches, warnings }
  }

  private checkControlCharacters(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []

    if (hasControlCharacters(cmd)) {
      matches.push("control_characters")
      warnings.push("Command contains control characters")
    }

    return { matches, warnings }
  }

  private checkUnicodeWhitespace(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []

    if (hasUnicodeWhitespace(cmd)) {
      matches.push("unicode_whitespace")
      warnings.push("Command contains invisible unicode whitespace")
    }

    return { matches, warnings }
  }

  private checkNewlines(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []

    if (hasNewlines(cmd)) {
      matches.push("newline_injection")
      warnings.push("Command contains newline characters (possible injection)")
    }

    return { matches, warnings }
  }

  private checkDangerousRedirections(
    cmd: string,
    astNode?: {
      type: string
      text: () => string
      children?: readonly { type: string; text: () => string; children?: readonly unknown[] }[]
    },
  ): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []

    // B-P2-2: AST-based pipe-to-interpreter detection
    // Walk pipeline nodes for pipe → command(name ∈ {sh,bash,python,...})
    if (astNode) {
      const dangerousInterpreters = new Set([
        "sh",
        "bash",
        "zsh",
        "dash",
        "fish",
        "pwsh",
        "powershell",
        "python",
        "python3",
        "python2",
        "ruby",
        "perl",
        "php",
        "node",
        "nodejs",
        "lua",
        "tclsh",
        "wish",
        "expect",
        "python3.11",
        "python3.12",
      ])

      const walkNode = (node: { type: string; text: () => string; children?: readonly unknown[] }): boolean => {
        // Check for pipeline
        if (node.type === "pipeline") {
          const children = node.children as
            | Array<{ type: string; text: () => string; children?: readonly unknown[] }>
            | undefined
          if (children && children.length >= 2) {
            // Check if any command in the pipeline is an interpreter
            for (const child of children) {
              if (child.type === "command") {
                const cmdChildren = child.children as Array<{ type: string; text: () => string }> | undefined
                if (cmdChildren && cmdChildren.length > 0) {
                  const firstChild = cmdChildren[0]
                  if (firstChild?.type === "command_name" || firstChild?.type === "word") {
                    const cmdName = firstChild
                      .text()
                      .toLowerCase()
                      .replace(/^["']|["']$/g, "")
                    if (dangerousInterpreters.has(cmdName)) {
                      matches.push(`ast_pipe_to_interpreter: ${cmdName}`)
                      warnings.push(`Command pipes output to dangerous interpreter: ${cmdName}`)
                      return true
                    }
                  }
                }
              }
            }
          }
        }

        // Recurse into children
        if (node.children) {
          for (const child of node.children as Array<{
            type: string
            text: () => string
            children?: readonly unknown[]
          }>) {
            if (walkNode(child)) return true
          }
        }
        return false
      }

      walkNode(astNode)
    }

    // Fallback to regex-based detection for non-AST cases
    if (matches.length === 0 && /\|.*(?:sh|bash|python|ruby|perl|php)/i.test(cmd)) {
      matches.push("pipe_to_interpreter")
      warnings.push("Command pipes output to a shell interpreter")
    }

    return { matches, warnings }
  }

  private checkIFSInjection(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []

    // Basic IFS detection
    if (/\$IFS|\$\{[^}]*IFS}/.test(cmd)) {
      matches.push("ifs_injection")
      warnings.push("Command contains IFS variable injection")
    }

    // Detect variable-name splitting over shell builtin names: ${I}${FS}, ${PATH}, ${LD_*}
    // Pattern: ${VAR} followed by more ${VAR} where VAR is a shell builtin/env var
    const shellBuiltinVars = ["IFS", "PATH", "HOME", "USER", "SHELL", "PWD", "TERM", "PS1", "PS2", "PS4"]
    const envPrefixVars = ["LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH"]
    const allDangerousVars = [...shellBuiltinVars, ...envPrefixVars, "LD_", "DYLD_", "PS"]

    // Match ${VAR}${VAR} pattern
    const tokenConcatPattern = /\$=\{([A-Z_]+)\}\$\{([A-Z_]+)\}/g
    let concatMatch
    while ((concatMatch = tokenConcatPattern.exec(cmd)) !== null) {
      const [, var1, var2] = concatMatch
      if (allDangerousVars.some((v) => var1.startsWith(v) || var2.startsWith(v))) {
        matches.push(`ifs_obfuscation_token_concat: ${concatMatch[0]}`)
        warnings.push(`Command contains token-concatenation obfuscation: ${concatMatch[0]}`)
      }
    }

    // Match $VAR$VAR pattern (c$I$FS""at style)
    const bareConcatPattern = /\$[A-Za-z_][A-Za-z0-9_]*\$[A-Za-z_][A-Za-z0-9_]*/g
    let bareMatch
    while ((bareMatch = bareConcatPattern.exec(cmd)) !== null) {
      const token = bareMatch[0]
      // Check if this looks like shell builtin concatenation
      const vars = token.slice(1).split("$").filter(Boolean)
      if (vars.some((v) => shellBuiltinVars.includes(v) || allDangerousVars.some((d) => v.startsWith(d)))) {
        matches.push(`ifs_obfuscation_bare_concat: ${token}`)
        warnings.push(`Command contains bare token-concatenation obfuscation: ${token}`)
      }
    }

    // Match mid-token expansion like c${IFS}at
    const midTokenPattern = /[a-zA-Z]\$\{[A-Z_]+}[a-zA-Z]/
    if (midTokenPattern.test(cmd)) {
      matches.push("ifs_obfuscation_midtoken")
      warnings.push("Command contains mid-token variable expansion obfuscation")
    }

    // Match quoted IFS forms like "$IFS" or '$IFS'
    const quotedIfsPattern = /["']?\$IFS["']?|\$\{IFS\}/
    if (quotedIfsPattern.test(cmd)) {
      matches.push("ifs_quoted_form")
      warnings.push("Command contains quoted IFS variable")
    }

    return { matches, warnings }
  }

  private checkProcEnviron(cmd: string): { matches: string[]; warnings: string[] } {
    const matches: string[] = []
    const warnings: string[] = []

    if (/\/proc\/.*\/environ/.test(cmd)) {
      matches.push("proc_environ_access")
      warnings.push("Command accesses /proc/*/environ")
    }

    return { matches, warnings }
  }

  private assessRiskLevel(matchedPatterns: string[], command: string): DangerSeverity {
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
