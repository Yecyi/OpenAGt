// Pattern libraries for dangerous shell command detection.
// This file contains data only; helpers and detectors decide how to apply it.

import type { CommandSubstitutionPattern, ObfuscatedFlagPattern } from "./danger-contracts"

export const COMMAND_SUBSTITUTION_PATTERNS: CommandSubstitutionPattern[] = [
  { pattern: /<\(/, message: "process substitution <()" },
  { pattern: />\(/, message: "process substitution >()" },
  { pattern: /=\(/, message: "Zsh process substitution =()" },
  { pattern: /(?:^|[\s;&|])=[a-zA-Z_]/, message: "Zsh equals expansion (=cmd)" },
  { pattern: /\$\(/, message: "$() command substitution" },
  { pattern: /\$\{/, message: "${} parameter substitution" },
  { pattern: /\$\[/, message: "$[] legacy arithmetic expansion" },
  { pattern: /~\[/, message: "Zsh-style parameter expansion" },
  { pattern: /\(e:/, message: "Zsh-style glob qualifiers" },
  { pattern: /\(\+/, message: "Zsh glob qualifier with command execution" },
  { pattern: /\}\s*always\s*\{/, message: "Zsh always block (try/always construct)" },
  { pattern: /<#/, message: "PowerShell comment syntax" },
]

export const BARE_SHELL_PREFIXES = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "csh",
  "tcsh",
  "ksh",
  "dash",
  "cmd",
  "powershell",
  "pwsh",
  "env",
  "xargs",
  "nice",
  "stdbuf",
  "nohup",
  "timeout",
  "time",
  "sudo",
  "doas",
  "pkexec",
])

export const ZSH_DANGEROUS_COMMANDS = new Set([
  "zmodload",
  "emulate",
  "sysopen",
  "sysread",
  "syswrite",
  "sysseek",
  "zpty",
  "ztcp",
  "zsocket",
  "mapfile",
  "zf_rm",
  "zf_mv",
  "zf_ln",
  "zf_chmod",
  "zf_chown",
  "zf_mkdir",
  "zf_rmdir",
  "zf_chgrp",
])

export const DANGEROUS_BASH_PATTERNS = [
  "python",
  "python2",
  "python3",
  "python3.11",
  "python3.12",
  "node",
  "nodejs",
  "bun",
  "deno",
  "ruby",
  "perl",
  "php",
  "lua",
  "iojs",
  "npx",
  "npm",
  "pnpm",
  "yarn",
  "bunx",
  "node-gyp",
  "zsh",
  "fish",
  "eval",
  "exec",
  "env",
  "xargs",
  "sudo",
]

export const OBFUSCATED_FLAG_PATTERNS: ObfuscatedFlagPattern[] = [
  {
    pattern: /\$'[^']*'/,
    message: "ANSI-C quoted string (possible obfuscation)",
  },
  {
    pattern: /\$"[^"]*"/,
    message: "Locale-quoted string (possible obfuscation)",
  },
  {
    pattern: /\$['"]{2}\s*-/,
    message: "Empty quotes followed by dash (flag hiding)",
  },
  {
    pattern: /(?:^|\s)(?:''|"")+\s*-/,
    message: "Consecutive empty quote pairs (flag hiding)",
  },
  {
    pattern: /(?:""|'')+['"]-/,
    message: "Same-type empty quotes adjacent to quoted dash",
  },
  {
    pattern: /(?:^|\s)['"]{3,}/,
    message: "Three or more consecutive quotes (obfuscation)",
  },
]

export const DANGEROUS_REDIRECTION_PATTERNS = [
  { pattern: />/, message: "Output redirection" },
  { pattern: />>/, message: "Output append redirection" },
  { pattern: /<.*/, message: "Input redirection" },
  { pattern: /\|\s*\w+/, message: "Pipe to command" },
]

export const BASH_SECURITY_CHECK_IDS = {
  INCOMPLETE_COMMANDS: 1,
  JQ_SYSTEM_FUNCTION: 2,
  JQ_FILE_ARGUMENTS: 3,
  OBFUSCATED_FLAGS: 4,
  SHELL_METACHARACTERS: 5,
  DANGEROUS_VARIABLES: 6,
  NEWLINES: 7,
  DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION: 8,
  DANGEROUS_PATTERNS_INPUT_REDIRECTION: 9,
  DANGEROUS_PATTERNS_OUTPUT_REDIRECTION: 10,
  IFS_INJECTION: 11,
  GIT_COMMIT_SUBSTITUTION: 12,
  PROC_ENVIRON_ACCESS: 13,
  MALFORMED_TOKEN_INJECTION: 14,
  BACKSLASH_ESCAPED_WHITESPACE: 15,
  BRACE_EXPANSION: 16,
  CONTROL_CHARACTERS: 17,
  UNICODE_WHITESPACE: 18,
  MID_WORD_HASH: 19,
  ZSH_DANGEROUS_COMMANDS: 20,
  BACKSLASH_ESCAPED_OPERATORS: 21,
  COMMENT_QUOTE_DESYNC: 22,
  QUOTED_NEWLINE: 23,
} as const

export const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/
export const UNICODE_WHITESPACE_RE = /[\u200b\u200c\u200d\ufeff]/
export const NEWLINE_RE = /\r?\n/
