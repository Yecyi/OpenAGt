import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"

/**
 * CLI Smoke Test Framework
 *
 * Tests CLI commands by spawning subprocesses. Each test:
 * 1. Creates a temporary directory
 * 2. Spawns the CLI with specific arguments
 * 3. Captures stdout/stderr
 * 4. Validates exit code and output
 * 5. Cleans up
 */

const CLI_ENTRY = path.resolve(import.meta.dir, "../../src/index.ts")

interface SmokeTestContext {
  tmp: Awaited<ReturnType<typeof tmpdir>>
  stdout: string
  stderr: string
  exitCode: number
}

async function runCLI(args: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<SmokeTestContext> {
  const cwd = options?.cwd ?? process.cwd()
  const env = { ...process.env, ...options?.env }

  const result = await $`bun run ${CLI_ENTRY} ${args}`.env(env).cwd(cwd).quiet()

  return {
    tmp: null as any,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  }
}

describe("CLI Smoke Tests", () => {
  describe("help", () => {
    test("--help shows usage information", async () => {
      const result = await $`bun run ${CLI_ENTRY} --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("openagt")
    })

    test("-h shows usage information", async () => {
      const result = await $`bun run ${CLI_ENTRY} -h`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("openagt")
    })
  })

  describe("version", () => {
    test("--version shows version", async () => {
      const result = await $`bun run ${CLI_ENTRY} --version`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toMatch(/\d+\.\d+\.\d+/)
    })

    test("-v shows version", async () => {
      const result = await $`bun run ${CLI_ENTRY} -v`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toMatch(/\d+\.\d+\.\d+/)
    })
  })

  describe("init", () => {
    test("creates project in new directory", async () => {
      await using tmp = await tmpdir()

      const result = await $`bun run ${CLI_ENTRY} init`
        .cwd(tmp.path)
        .quiet()

      // init may fail without git credentials, but should not crash
      expect([0, 1]).toContain(result.exitCode)
    })

    test("init --help works", async () => {
      const result = await $`bun run ${CLI_ENTRY} init --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("init")
    })
  })

  describe("session", () => {
    test("session --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} session --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("session")
    })

    test("session list works without session", async () => {
      await using tmp = await tmpdir({ git: true })

      const result = await $`bun run ${CLI_ENTRY} session list`
        .cwd(tmp.path)
        .quiet()

      // May fail if server not running, but should not crash
      expect([0, 1]).toContain(result.exitCode)
    })
  })

  describe("providers", () => {
    test("providers --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} providers --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("providers")
    })

    test("providers list shows available providers", async () => {
      const result = await $`bun run ${CLI_ENTRY} providers list`
        .quiet()

      expect(result.exitCode).toBe(0)
    })
  })

  describe("models", () => {
    test("models --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} models --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("models")
    })

    test("models list works", async () => {
      const result = await $`bun run ${CLI_ENTRY} models list`
        .quiet()

      expect(result.exitCode).toBe(0)
    }, 120_000)
  })

  describe("agent", () => {
    test("agent --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} agent --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("agent")
    })
  })

  describe("serve", () => {
    test("serve --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} serve --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("serve")
    })

    test("serve --version shows server version", async () => {
      const result = await $`bun run ${CLI_ENTRY} serve --version`
        .quiet()

      expect(result.exitCode).toBe(0)
    })
  })

  describe("debug", () => {
    test("debug --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} debug --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("debug")
    })

    test("debug agent --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} debug agent --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("agent")
    })

    test("debug config --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} debug config --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("config")
    })
  })

  describe("mcp", () => {
    test("mcp --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} mcp --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("mcp")
    })

    test("mcp start --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} mcp start --help`
        .quiet()

      expect(result.exitCode).toBe(0)
    })
  })

  describe("acp", () => {
    test("acp --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} acp --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("acp")
    })
  })

  describe("error handling", () => {
    test("unknown command does not crash", async () => {
      const result = await $`bun run ${CLI_ENTRY} unknown-command-12345`
        .quiet()

      // Should fail gracefully, not crash
      expect(result.exitCode).not.toBe(139) // SIGSEGV
      expect(result.exitCode).not.toBe(134) // SIGABRT
    })

    test("malformed arguments do not crash", async () => {
      const result = await $`bun run ${CLI_ENTRY} --invalid-option`
        .nothrow()
        .quiet()

      // Should show error, not crash
      expect(result.exitCode).toBeGreaterThan(0)
      expect((result.stderr.toString() + result.stdout.toString()).toLowerCase()).toContain("error")
    })
  })

  describe("stats", () => {
    test("stats --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} stats --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("stats")
    })
  })

  describe("export", () => {
    test("export --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} export --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("export")
    })
  })

  describe("import", () => {
    test("import --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} import --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("import")
    })
  })

  describe("github", () => {
    test("github --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} github --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("github")
    })
  })

  describe("pr", () => {
    test("pr --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} pr --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("pull request")
    })
  })

  describe("account", () => {
    test("account --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} account --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("account")
    })
  })

  describe("plug", () => {
    test("plug --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} plug --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("plugin")
    })

    test("plug list shows plugins", async () => {
      const result = await $`bun run ${CLI_ENTRY} plug list`
        .quiet()

      // May fail without plugins, but should not crash
      expect([0, 1]).toContain(result.exitCode)
    })
  })

  describe("upgrade", () => {
    test("upgrade --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} upgrade --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("upgrade")
    })
  })

  describe("db", () => {
    test("db --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} db --help`
        .quiet()

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("database")
    })
  })

  describe("web", () => {
    test("web --help shows usage", async () => {
      const result = await $`bun run ${CLI_ENTRY} web --help`
        .quiet()

      expect(result.exitCode).toBe(0)
    })
  })
})
