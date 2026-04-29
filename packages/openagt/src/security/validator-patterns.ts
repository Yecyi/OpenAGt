// Regex constants used by shell command validators.
// This file centralizes patterns only; it does not run validation.

export const SHELL_METACHAR_PATTERNS = [
  /(?:^|\s)["'][^"']*[;&|][^"']*["'](?:\s|$)/,
  /-name\s+["'][^"']*[;&|][^"']*["']/,
  /-path\s+["'][^"']*[;&|][^"']*["']/,
  /-iname\s+["'][^"']*[;&|][^"']*["']/,
  /-regex\s+["'][^"']*[;&|][^"']*["']/,
]

export const BRACE_PATTERN = /[{}]/
export const UNQUOTED_CLOSE_BRACE_EXCESS = /(?<![\\'"])[}][^;|&$<>`\n\r]*$/

export const HEREDOC_PATTERN = /\$\(cat[ \t]*<<(-?)[ \t]*(?:'+([A-Za-z_]\w*)'+|\\([A-Za-z_]\w*))/
export const SAFE_HEREDOC_SUBSTITUTION_RE =
  /^\s*\$\(cat[ \t]*<<-?[ \t]*(?:'([A-Za-z_]\w*)'|\\([A-Za-z_]\w*))[ \t]*\r?\n([\s\S]*)\r?\n([A-Za-z_]\w*)[ \t]*\)\s*$/

export const GIT_COMMIT_PATTERN = /^git[ \t]+commit[ \t]+[^;&|`$<>()\n\r]*?-m[ \t]+(["'])([\s\S]*?)\1(.*)$/

export const JQ_SYSTEM_PATTERN = /\bsystem\s*\(/
export const JQ_DANGEROUS_FLAGS = /(?:^|\s)(?:-f\b|--from-file|--rawfile|--slurpfile|-L\b|--library-path)/

export const IFS_PATTERN = /\$IFS|\$\{[^}]*IFS/
export const PROC_ENVIRON_PATTERN = /\/proc\/.*\/environ/
export const UNICODE_WHITESPACE_RE = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/
export const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/

export const SHELL_OPERATORS = new Set([";", "|", "&", "<", ">"])

export const OBFUSCATED_PATTERNS = [
  /\$'[^']*'/,
  /\$"[^"]*"/,
  /\$['"]{2}\s*-/,
  /(?:^|\s)(?:''|"")+\s*-/,
  /(?:""|'')+['"]-/,
  /(?:^|\s)['"]{3,}/,
]
