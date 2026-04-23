/**
 * Fast-path CLI optimization
 *
 * Provides zero-import shortcuts for common operations like --version, --help
 * to minimize startup time for frequently used commands.
 *
 * Inspired by Claude Code's fast-path implementation.
 */

// Fast-path: zero-import command handlers
const FAST_PATH_COMMANDS = new Set([
  "--version",
  "-v",
  "--help",
  "-h",
  "version",
  "help",
])

// Version info - hardcoded to avoid importing InstallationVersion
const VERSION = "1.15.0"

/**
 * Check if the current command should use fast-path
 */
export function isFastPathCommand(args: string[]): boolean {
  if (args.length === 0) return false

  const cmd = args[0]

  // Direct fast-path commands
  if (FAST_PATH_COMMANDS.has(cmd)) return true

  // Check for --version/-v flags with other args
  if (cmd.startsWith("--") && (cmd === "--version")) return true
  if (cmd.startsWith("-") && (cmd === "-v")) return true

  return false
}

/**
 * Execute fast-path command without loading full modules
 */
export function executeFastPath(args: string[]): { exit: boolean; code: number } {
  const cmd = args[0]

  switch (cmd) {
    case "--version":
    case "-v":
    case "version": {
      console.log(`${VERSION} (OpenAGt)`)
      return { exit: true, code: 0 }
    }

    case "--help":
    case "-h":
    case "help": {
      console.log(getHelpText())
      return { exit: true, code: 0 }
    }

    default:
      return { exit: false, code: 0 }
  }
}

/**
 * Get minimal help text without importing full CLI
 */
function getHelpText(): string {
  return `openagt ${VERSION}

Usage: openagt [command] [options]

Commands:
  run                 Run the agent in the current directory
  ask                 Ask a single question without starting a session
  session             Manage sessions
  agent               Manage agents
  providers           Manage AI providers
  models              Manage models
  mcp                 Model Context Protocol tools
  serve               Start the OpenAGt server
  web                 Start the web UI
  debug               Debugging tools
  upgrade             Check for updates
  uninstall           Uninstall OpenAGt

Options:
  --version, -v       Show version number
  --help, -h         Show this help message
  --print-logs       Print logs to stderr
  --log-level         Set log level (DEBUG, INFO, WARN, ERROR)
  --pure             Run without external plugins

Examples:
  openagt run                    Start an agent session
  openagt ask "Hello world"      Ask a single question
  openagt session list           List all sessions
  openagt providers login        Add a provider

For more information, see https://openag.dev/docs`
}

/**
 * Get startup profiling data if enabled
 */
export interface StartupProfile {
  args: string[]
  timestamp: number
  fastPath: boolean
  elapsedMs?: number
}

const startupProfiles: StartupProfile[] = []

export function recordStartup(args: string[], fastPath: boolean): void {
  startupProfiles.push({
    args,
    timestamp: Date.now(),
    fastPath,
  })
}

export function getStartupProfiles(): StartupProfile[] {
  return [...startupProfiles]
}

export function clearStartupProfiles(): void {
  startupProfiles.length = 0
}

/**
 * Performance marker for startup timing
 */
export class StartupTimer {
  private startTime: number
  private marks: Map<string, number> = new Map()

  constructor() {
    this.startTime = Date.now()
  }

  mark(name: string): void {
    this.marks.set(name, Date.now() - this.startTime)
  }

  getElapsed(): number {
    return Date.now() - this.startTime
  }

  getMarks(): Map<string, number> {
    return new Map(this.marks)
  }

  getReport(): string {
    const lines = [`Startup timing report (${this.getElapsed()}ms total):`]
    for (const [name, ms] of this.marks.entries()) {
      lines.push(`  ${name}: ${ms}ms`)
    }
    return lines.join("\n")
  }
}
