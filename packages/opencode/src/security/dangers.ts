/**
 * Security Dangers Module
 *
 * Comprehensive dangerous pattern detection based on CC Source Code's bashSecurity.ts.
 * Provides pattern libraries for detecting dangerous commands, variables, and obfuscation techniques.
 *
 * Reference: Code Reference/CC Source Code/src/tools/BashTool/bashSecurity.ts
 */

// ============================================================
// Command Substitution Patterns (8 patterns)
// ============================================================

export interface CommandSubstitutionPattern {
  pattern: RegExp
  message: string
}

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

// ============================================================
// Environment Variable Patterns
// ============================================================

/**
 * Binary hijack variables - these can be used to inject malicious code
 * by prepending custom library paths or executing arbitrary code
 */
export const BINARY_HIJACK_VARS = /^(LD_|DYLD_|PATH$)/

/**
 * Safe environment variables whitelist - only these variables are allowed
 * in command execution context
 */
export const SAFE_ENV_VARS = new Set([
  // Go
  "GOEXPERIMENT",
  "GOOS",
  "GOARCH",
  "CGO_ENABLED",
  "GO111MODULE",
  // Rust
  "RUST_BACKTRACE",
  "RUST_LOG",
  // Node/Python
  "NODE_ENV",
  "PYTHONUNBUFFERED",
  "PYTHONDONTWRITEBYTECODE",
  // API/Auth
  "ANTHROPIC_API_KEY",
  // Locale/Terminal
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_TIME",
  "CHARSET",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "TZ",
  // Tool color configuration
  "LS_COLORS",
  "LSCOLORS",
  "GREP_COLOR",
  "GREP_COLORS",
  "GCC_COLORS",
  "TIME_STYLE",
  "BLOCK_SIZE",
  "BLOCKSIZE",
])

/**
 * Additional safe environment variables for ANT-specific context
 */
export const ANT_ONLY_SAFE_ENV_VARS = new Set([
  "KUBECONFIG",
  "DOCKER_HOST",
  "AWS_PROFILE",
  "CLOUDSDK_CORE_PROJECT",
  "CLUSTER",
  "COO_CLUSTER",
  "COO_CLUSTER_NAME",
  "COO_NAMESPACE",
  "CUDA_VISIBLE_DEVICES",
  "JAX_PLATFORMS",
  "PGPASSWORD",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITEA_TOKEN",
  "GITLAB_TOKEN",
])

// ============================================================
// Shell Prefix Patterns
// ============================================================

/**
 * Bare shell prefixes - commands that start a new shell interpreter
 * These require special handling as they can execute arbitrary code
 */
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

// ============================================================
// Zsh Dangerous Commands
// ============================================================

/**
 * Zsh dangerous commands - these can load arbitrary code/modules
 * or manipulate the shell environment in dangerous ways
 */
export const ZSH_DANGEROUS_COMMANDS = new Set([
  "zmodload", // Load zsh modules (can load native code)
  "emulate", // Set emulation mode (can bypass security)
  "sysopen", // Open file descriptors
  "sysread", // Read from file descriptors
  "syswrite", // Write to file descriptors
  "sysseek", // Seek in file descriptors
  "zpty", // Pseudo-terminal operations
  "ztcp", // TCP operations in zsh
  "zsocket", // Socket operations
  "mapfile", // Access files as arrays
  // Zsh file manipulation (zf*) - bypass some safety checks
  "zf_rm",
  "zf_mv",
  "zf_ln",
  "zf_chmod",
  "zf_chown",
  "zf_mkdir",
  "zf_rmdir",
  "zf_chgrp",
])

// ============================================================
// Dangerous Bash Patterns
// ============================================================

/**
 * Dangerous bash patterns - commands that can execute arbitrary code
 * or perform dangerous system operations
 */
export const DANGEROUS_BASH_PATTERNS = [
  // Cross-platform code execution
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
  // Package managers that can execute code
  "npx",
  "npm",
  "pnpm",
  "yarn",
  "bunx",
  "node-gyp",
  // Shell interpreters
  "zsh",
  "fish",
  "eval", // Direct eval - extremely dangerous
  "exec", // Replace current process
  "env", // Execute with modified environment
  "xargs", // Execute command with arguments
  "sudo", // Privilege escalation
]

// ============================================================
// Obfuscated Flag Patterns (6 patterns)
// ============================================================

export interface ObfuscatedFlagPattern {
  pattern: RegExp
  message: string
}

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

// ============================================================
// Redirection Patterns
// ============================================================

export const DANGEROUS_REDIRECTION_PATTERNS = [
  { pattern: />/, message: "Output redirection" },
  { pattern: />>/, message: "Output append redirection" },
  { pattern: /<.*/, message: "Input redirection" },
  { pattern: /\|\s*\w+/, message: "Pipe to command" },
]

// ============================================================
// Validation Result Types
// ============================================================

export type DangerSeverity = "high" | "medium" | "low" | "safe"

export interface ValidationCheck {
  id: number
  name: string
  passed: boolean
  message?: string
}

export interface ValidationResult {
  valid: boolean
  severity: DangerSeverity
  checks: ValidationCheck[]
}

// ============================================================
// Validation Check IDs (matching CC Source Code)
// ============================================================

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

// ============================================================
// Control Character Patterns
// ============================================================

/**
 * Control characters that should not appear in normal user input
 */
export const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/

/**
 * Unicode whitespace characters that may be used for obfuscation
 */
export const UNICODE_WHITESPACE_RE = /[\u200b\u200c\u200d\ufeff]/

/**
 * Newline characters that may break command parsing
 */
export const NEWLINE_RE = /\r?\n/

// ============================================================
// Helper Functions
// ============================================================

/**
 * Check if a command starts with a bare shell prefix
 */
export function hasBareShellPrefix(command: string): boolean {
  const firstToken = command.trim().split(/\s+/)[0]
  return BARE_SHELL_PREFIXES.has(firstToken)
}

/**
 * Check if a string contains any control characters
 */
export function hasControlCharacters(input: string): boolean {
  return CONTROL_CHAR_RE.test(input)
}

/**
 * Check if a string contains unicode whitespace
 */
export function hasUnicodeWhitespace(input: string): boolean {
  return UNICODE_WHITESPACE_RE.test(input)
}

/**
 * Check if a string contains newlines
 */
export function hasNewlines(input: string): boolean {
  return NEWLINE_RE.test(input)
}

/**
 * Check if a command contains dangerous patterns
 */
export function containsDangerousPatterns(command: string): boolean {
  const lowerCommand = command.toLowerCase()
  return DANGEROUS_BASH_PATTERNS.some((pattern) => lowerCommand.includes(pattern))
}

/**
 * Check if a token contains zsh dangerous commands
 */
export function hasZshDangerousCommand(tokens: string[]): string | null {
  for (const token of tokens) {
    if (ZSH_DANGEROUS_COMMANDS.has(token)) {
      return token
    }
  }
  return null
}
