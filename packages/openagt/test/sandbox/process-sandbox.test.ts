import { describe, expect, test, beforeEach } from "bun:test"
import {
  getSandboxStats,
  resetSandboxStats,
  spawnBatchWithSandbox,
  killAllProcesses,
  getResourceUsage,
  spawnWithSandbox,
  spawnWithSandboxSync,
} from "../../src/sandbox/process-sandbox"
import { Shell } from "../../src/shell/shell"

const isWindows = process.platform === "win32"

describe("spawnBatchWithSandbox", () => {
  test("executes multiple commands", async () => {
    const commands = ["echo a", "echo b", "echo c"]
    const results = await spawnBatchWithSandbox(commands, { timeoutMs: 5000 })
    expect(results.length).toBe(3)
  })

  test("respects maxConcurrent limit", async () => {
    const commands = ["sleep 0.1", "sleep 0.1", "sleep 0.1"]
    const results = await spawnBatchWithSandbox(commands, { maxConcurrent: 1, timeoutMs: 10000 })
    expect(results.length).toBe(3)
  })
})

describe("getSandboxStats", () => {
  beforeEach(() => {
    resetSandboxStats()
  })

  test("tracks spawned processes", async () => {
    const stats = getSandboxStats()
    expect(stats.totalSpawned).toBe(0)
    await spawnWithSandbox("echo test", { timeoutMs: 5000 })
    const newStats = getSandboxStats()
    expect(newStats.totalSpawned).toBeGreaterThan(0)
  })

  test("tracks current running", async () => {
    const stats = getSandboxStats()
    expect(stats.currentRunning).toBe(0)
  })

  test("resets stats", () => {
    resetSandboxStats()
    const stats = getSandboxStats()
    expect(stats.totalSpawned).toBe(0)
    expect(stats.totalKilled).toBe(0)
    expect(stats.currentRunning).toBe(0)
  })
})

describe("spawnWithSandbox", () => {
  test("returns stdout for successful commands", async () => {
    const command = isWindows ? "echo sandbox-output" : "printf 'sandbox-output'"
    const result = await spawnWithSandbox(command, { timeoutMs: 5000, shell: isWindows ? "cmd.exe" : "/bin/sh" })
    expect(result.stdout).toContain("sandbox-output")
    expect(result.timedOut).toBe(false)
  })

  test("marks timed out commands", async () => {
    const command = isWindows ? "ping 127.0.0.1 -n 6 > nul" : "sleep 5"
    const result = await spawnWithSandbox(command, { timeoutMs: 50, shell: isWindows ? "cmd.exe" : "/bin/sh" })
    expect(result.timedOut).toBe(true)
    expect(result.killed).toBe(true)
  })

  test("truncates large output", async () => {
    const command = isWindows ? "echo 1234567890" : "printf '1234567890'"
    const result = await spawnWithSandbox(command, {
      timeoutMs: 5000,
      shell: isWindows ? "cmd.exe" : "/bin/sh",
      limits: { maxFileSize: 4 },
    })
    expect(result.outputTruncated).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(4)
  })

  test("supports powershell shell on windows", async () => {
    if (!isWindows) return
    const result = await spawnWithSandbox("Write-Output sandbox-ps", {
      timeoutMs: 5000,
      shell: "powershell.exe",
    })
    expect(result.stdout).toContain("sandbox-ps")
  })

  test("supports posix shells on windows", async () => {
    if (!isWindows) return
    const shell = Shell.gitbash()
    if (!shell) return
    const result = await spawnWithSandbox("printf 'sandbox-bash'", {
      timeoutMs: 5000,
      shell,
    })
    expect(result.stdout).toContain("sandbox-bash")
  })
})

describe("spawnWithSandboxSync", () => {
  test("applies output truncation", () => {
    const command = isWindows ? "echo 1234567890" : "printf '1234567890'"
    const result = spawnWithSandboxSync(command, {
      shell: isWindows ? "cmd.exe" : "/bin/sh",
      limits: { maxFileSize: 4 },
    })
    expect(result.outputTruncated).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(4)
  })
})

describe("killAllProcesses", () => {
  test("kills all running processes", async () => {
    resetSandboxStats()
    killAllProcesses()
    const stats = getSandboxStats()
    expect(stats.currentRunning).toBe(0)
  })
})

describe("getResourceUsage", () => {
  test("returns resource usage for current process", () => {
    const usage = getResourceUsage(process.pid)
    expect(usage.pid).toBe(process.pid)
  })

  test("handles non-existent pid", () => {
    const usage = getResourceUsage(999999)
    expect(usage.pid).toBe(999999)
  })
})
