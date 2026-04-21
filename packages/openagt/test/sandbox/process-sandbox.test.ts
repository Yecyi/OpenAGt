import { describe, expect, test, beforeEach } from "bun:test"
import {
  getSandboxStats,
  resetSandboxStats,
  spawnBatchWithSandbox,
  killAllProcesses,
  getResourceUsage,
  spawnWithSandbox,
} from "../../src/sandbox/process-sandbox"

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
