// Pattern checks used by CommandClassifier.
// This file returns matched pattern strings and warnings; risk scoring stays separate.

import { BINARY_HIJACK_VARS } from "./danger-env"
import { hasControlCharacters, hasNewlines, hasUnicodeWhitespace } from "./danger-helpers"
import {
  BARE_SHELL_PREFIXES,
  COMMAND_SUBSTITUTION_PATTERNS,
  DANGEROUS_BASH_PATTERNS,
  OBFUSCATED_FLAG_PATTERNS,
  ZSH_DANGEROUS_COMMANDS,
} from "./danger-patterns"
import type { ClassifierAstNode, PatternCheckResult } from "./command-classifier-contracts"

const DESTRUCTIVE_RM_PATTERN =
  /\brm\b(?=[^;&|]*\s-[^\s;&|]*r)(?=[^;&|]*\s-[^\s;&|]*f)[^;&|]*(?:^|\s)(?:\/|\*|~)(?:\s|$)/i

export function runPatternChecks(command: string): PatternCheckResult[] {
  return [
    checkCommandSubstitution(command),
    checkDangerousVariables(command),
    checkZshDangerous(command),
    checkDangerousBash(command),
    checkObfuscatedFlags(command),
    checkBareShellPrefixes(command),
    checkControlCharacters(command),
    checkUnicodeWhitespace(command),
    checkNewlines(command),
    checkDangerousRedirections(command),
    checkIFSInjection(command),
    checkProcEnviron(command),
  ]
}

export function checkCommandSubstitution(cmd: string): PatternCheckResult {
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

export function checkDangerousVariables(cmd: string): PatternCheckResult {
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

export function checkZshDangerous(cmd: string): PatternCheckResult {
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

export function checkDangerousBash(cmd: string): PatternCheckResult {
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

export function checkObfuscatedFlags(cmd: string): PatternCheckResult {
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

export function checkBareShellPrefixes(cmd: string): PatternCheckResult {
  const matches: string[] = []
  const warnings: string[] = []
  const firstToken = cmd.trim().split(/\s+/)[0]

  if (BARE_SHELL_PREFIXES.has(firstToken)) {
    matches.push(`bare_shell_prefix: ${firstToken}`)
    warnings.push(`Bare shell prefix detected: ${firstToken}`)
  }

  return { matches, warnings }
}

export function checkControlCharacters(cmd: string): PatternCheckResult {
  const matches: string[] = []
  const warnings: string[] = []

  if (hasControlCharacters(cmd)) {
    matches.push("control_characters")
    warnings.push("Command contains control characters")
  }

  return { matches, warnings }
}

export function checkUnicodeWhitespace(cmd: string): PatternCheckResult {
  const matches: string[] = []
  const warnings: string[] = []

  if (hasUnicodeWhitespace(cmd)) {
    matches.push("unicode_whitespace")
    warnings.push("Command contains invisible unicode whitespace")
  }

  return { matches, warnings }
}

export function checkNewlines(cmd: string): PatternCheckResult {
  const matches: string[] = []
  const warnings: string[] = []

  if (hasNewlines(cmd)) {
    matches.push("newline_injection")
    warnings.push("Command contains newline characters (possible injection)")
  }

  return { matches, warnings }
}

export function checkDangerousRedirections(cmd: string, astNode?: ClassifierAstNode): PatternCheckResult {
  const matches: string[] = []
  const warnings: string[] = []

  // B-P2-2: AST-based pipe-to-interpreter detection
  // Walk pipeline nodes for pipe -> command(name in {sh,bash,python,...})
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
      if (node.type === "pipeline") {
        const children = node.children as
          | Array<{ type: string; text: () => string; children?: readonly unknown[] }>
          | undefined
        if (children && children.length >= 2) {
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

  if (matches.length === 0 && /\|.*(?:sh|bash|python|ruby|perl|php)/i.test(cmd)) {
    matches.push("pipe_to_interpreter")
    warnings.push("Command pipes output to a shell interpreter")
  }

  return { matches, warnings }
}

export function checkIFSInjection(cmd: string): PatternCheckResult {
  const matches: string[] = []
  const warnings: string[] = []

  if (/\$IFS|\$\{[^}]*IFS}/.test(cmd)) {
    matches.push("ifs_injection")
    warnings.push("Command contains IFS variable injection")
  }

  const shellBuiltinVars = ["IFS", "PATH", "HOME", "USER", "SHELL", "PWD", "TERM", "PS1", "PS2", "PS4"]
  const envPrefixVars = ["LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH"]
  const allDangerousVars = [...shellBuiltinVars, ...envPrefixVars, "LD_", "DYLD_", "PS"]

  const tokenConcatPattern = /\$=\{([A-Z_]+)\}\$\{([A-Z_]+)\}/g
  let concatMatch
  while ((concatMatch = tokenConcatPattern.exec(cmd)) !== null) {
    const [, var1, var2] = concatMatch
    if (allDangerousVars.some((v) => var1.startsWith(v) || var2.startsWith(v))) {
      matches.push(`ifs_obfuscation_token_concat: ${concatMatch[0]}`)
      warnings.push(`Command contains token-concatenation obfuscation: ${concatMatch[0]}`)
    }
  }

  const bareConcatPattern = /\$[A-Za-z_][A-Za-z0-9_]*\$[A-Za-z_][A-Za-z0-9_]*/g
  let bareMatch
  while ((bareMatch = bareConcatPattern.exec(cmd)) !== null) {
    const token = bareMatch[0]
    const vars = token.slice(1).split("$").filter(Boolean)
    if (vars.some((v) => shellBuiltinVars.includes(v) || allDangerousVars.some((d) => v.startsWith(d)))) {
      matches.push(`ifs_obfuscation_bare_concat: ${token}`)
      warnings.push(`Command contains bare token-concatenation obfuscation: ${token}`)
    }
  }

  const midTokenPattern = /[a-zA-Z]\$\{[A-Z_]+}[a-zA-Z]/
  if (midTokenPattern.test(cmd)) {
    matches.push("ifs_obfuscation_midtoken")
    warnings.push("Command contains mid-token variable expansion obfuscation")
  }

  const quotedIfsPattern = /["']?\$IFS["']?|\$\{IFS\}/
  if (quotedIfsPattern.test(cmd)) {
    matches.push("ifs_quoted_form")
    warnings.push("Command contains quoted IFS variable")
  }

  return { matches, warnings }
}

export function checkProcEnviron(cmd: string): PatternCheckResult {
  const matches: string[] = []
  const warnings: string[] = []

  if (/\/proc\/.*\/environ/.test(cmd)) {
    matches.push("proc_environ_access")
    warnings.push("Command accesses /proc/*/environ")
  }

  return { matches, warnings }
}
