const nonTuiCommands = new Set([
  "acp",
  "mcp",
  "run",
  "generate",
  "init",
  "debug",
  "account",
  "providers",
  "agent",
  "upgrade",
  "uninstall",
  "serve",
  "web",
  "models",
  "stats",
  "export",
  "import",
  "github",
  "pr",
  "session",
  "plug",
  "db",
  "experts",
  "cal",
  "prompt",
  "mem",
  "mission",
  "completion",
  "help",
  "version",
])

const helpAndVersionFlags = new Set(["-h", "--help", "-v", "--version"])
const topLevelOptionsWithValue = new Set(["--log-level"])

export function needsTuiCommands(args: string[]) {
  const first = (() => {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (!arg || arg === "--") continue
      if (helpAndVersionFlags.has(arg)) return arg
      if (topLevelOptionsWithValue.has(arg)) {
        i++
        continue
      }
      if (arg.startsWith("--log-level=")) continue
      if (arg.startsWith("-")) continue
      return arg
    }
  })()

  if (!first) return true
  if (helpAndVersionFlags.has(first)) return false
  if (first === "attach") return true
  return !nonTuiCommands.has(first)
}
