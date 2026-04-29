/**
 * Process Sandbox - Subprocess Resource Limiter
 *
 * Provides subprocess-level resource limits and bounded IO collection.
 * The limits are best-effort and mainly affect Node/Bun-based subprocesses.
 */

import { spawn } from "bun"
import { Effect, Layer, Context } from "effect"
import { spawn as nodeSpawn } from "child_process"
import { Log } from "../util"
import { applySandboxResourceLimits, buildSandboxArgs } from "./process-sandbox-command"
import type {
  BatchSandboxOptions,
  BunChildProcess,
  Interface,
  ProcessSandboxOptions,
  ProcessSandboxResult,
  ProcessSandboxStats,
  ResourceUsage,
} from "./process-sandbox-contracts"
export type {
  BatchSandboxOptions,
  BunChildProcess,
  Interface,
  ProcessSandboxOptions,
  ProcessSandboxResult,
  ProcessSandboxStats,
  ResourceLimits,
  ResourceUsage,
} from "./process-sandbox-contracts"
import { collectStream, truncateOutput } from "./process-sandbox-output"

const log = Log.create({ service: "process-sandbox" })

const stats: ProcessSandboxStats = {
  totalSpawned: 0,
  totalKilled: 0,
  totalTimeouts: 0,
  totalKilledByResourceLimit: 0,
  currentRunning: 0,
}

export function getSandboxStats(): ProcessSandboxStats {
  return { ...stats }
}

export function resetSandboxStats(): void {
  stats.totalSpawned = 0
  stats.totalKilled = 0
  stats.totalTimeouts = 0
  stats.totalKilledByResourceLimit = 0
  stats.currentRunning = 0
}

async function killProcessTree(pid: number | undefined, graceMs = 2000) {
  if (!pid) return

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      // SIGTERM via taskkill without /f gives processes a chance to clean up
      const killer = nodeSpawn("taskkill", ["/pid", String(pid), "/t"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("exit", () => resolve())
      killer.once("error", () => resolve())
      // Force kill after grace period
      setTimeout(() => {
        const forced = nodeSpawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
        })
        forced.once("exit", () => resolve())
        forced.once("error", () => resolve())
      }, graceMs)
    })
    return
  }

  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch (err) {
      log.warn("failed to kill process tree", { pid, error: err })
    }
  }
  // Force kill after grace period
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      try {
        process.kill(pid, "SIGKILL")
      } catch {}
    }
  }, graceMs)
}

export async function spawnWithSandbox(
  command: string,
  options: ProcessSandboxOptions = {},
): Promise<ProcessSandboxResult> {
  const {
    timeoutMs = 30000,
    cwd = process.cwd(),
    env = process.env as Record<string, string>,
    limits,
    shell,
    killGraceMs = 2000,
  } = options

  stats.totalSpawned++
  stats.currentRunning++

  const [cmd, args] = buildSandboxArgs(command, shell)
  const mergedEnv = { ...env, ...applySandboxResourceLimits(options) }

  let timedOut = false
  let killed = false
  let outputBytesTruncated = false

  // Combined output byte limit (stdout + stderr)
  const maxOutputBytes = limits?.maxOutputBytes ?? (limits?.maxFileSize ? limits.maxFileSize * 2 : undefined)

  return new Promise<ProcessSandboxResult>((resolve) => {
    const child = spawn({
      cmd: [cmd, ...args],
      cwd,
      env: mergedEnv,
      stderr: "pipe",
      stdout: "pipe",
      stdin: "ignore",
    })

    const stdoutPromise = collectStream(child.stdout, limits?.maxFileSize)
    const stderrPromise = collectStream(child.stderr, limits?.maxFileSize)

    // Track total bytes emitted across both streams for combined limit
    let totalOutputBytes = 0

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            killed = true
            stats.totalTimeouts++
            stats.totalKilled++
            void killProcessTree(child.pid, killGraceMs)
          }, timeoutMs)
        : undefined

    child.exited
      .then(async (exitCode) => {
        if (timer) clearTimeout(timer)
        stats.currentRunning--
        const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])

        resolve({
          stdout: stdout.text,
          stderr: stderr.text,
          exitCode,
          timedOut,
          killed,
          outputTruncated: stdout.truncated || stderr.truncated,
          outputBytesTruncated,
        })
      })
      .catch(async (error) => {
        if (timer) clearTimeout(timer)
        stats.currentRunning--
        const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])

        resolve({
          stdout: stdout.text,
          stderr: stderr.text || String(error),
          exitCode: -1,
          timedOut,
          killed,
          outputTruncated: stdout.truncated || stderr.truncated,
          outputBytesTruncated,
        })
      })
  })
}

export function spawnWithSandboxSync(command: string, options: ProcessSandboxOptions = {}): ProcessSandboxResult {
  const { timeoutMs = 30000, cwd = process.cwd(), env = process.env as Record<string, string>, limits, shell } = options

  stats.totalSpawned++
  stats.currentRunning++

  const { spawnSync } = require("child_process")
  const [cmd, args] = buildSandboxArgs(command, shell)
  const mergedEnv = { ...env, ...applySandboxResourceLimits(options) }
  const result = spawnSync(cmd, args, {
    cwd,
    env: mergedEnv,
    timeout: timeoutMs,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })

  stats.currentRunning--

  const timedOut =
    result.signal === "SIGTERM" || result.signal === "SIGKILL" || !!result.error?.message?.includes("timed out")
  if (timedOut) stats.totalTimeouts++
  if (timedOut) stats.totalKilled++

  const stdout = truncateOutput(result.stdout ?? "", limits?.maxFileSize)
  const stderr = truncateOutput(result.stderr ?? (result.error ? String(result.error.message) : ""), limits?.maxFileSize)

  return {
    stdout: stdout.text,
    stderr: stderr.text,
    exitCode: result.status,
    timedOut,
    killed: timedOut,
    outputTruncated: stdout.truncated || stderr.truncated,
    outputBytesTruncated: false,
  }
}

export async function spawnBatchWithSandbox(
  commands: string[],
  options: BatchSandboxOptions = {},
): Promise<ProcessSandboxResult[]> {
  const { maxConcurrent = 4, ...rest } = options
  const results: Array<ProcessSandboxResult | undefined> = new Array(commands.length)
  const queue = commands.map((command, index) => ({ command, index }))
  const running: Promise<void>[] = []

  while (queue.length > 0 || running.length > 0) {
    while (running.length < maxConcurrent && queue.length > 0) {
      const item = queue.shift()!
      const promise = spawnWithSandbox(item.command, rest).then((result) => {
        results[item.index] = result
        running.splice(running.indexOf(promise), 1)
      })
      running.push(promise)
    }

    if (running.length > 0) {
      await Promise.race(running)
    }
  }

  return results.filter((result): result is ProcessSandboxResult => !!result)
}

const activeProcesses = new Map<number, BunChildProcess>()

export function registerProcess(pid: number, process: BunChildProcess): void {
  activeProcesses.set(pid, process)
  stats.totalSpawned++
  stats.currentRunning++
}

export function unregisterProcess(pid: number): void {
  activeProcesses.delete(pid)
  stats.currentRunning = Math.max(0, stats.currentRunning - 1)
}

export function killProcessByPid(pid: number): boolean {
  const process = activeProcesses.get(pid)
  if (!process) return false
  process.kill()
  stats.totalKilled++
  return true
}

export function killAllProcesses(): number {
  let killed = 0
  for (const [pid, process] of activeProcesses) {
    process.kill()
    killed++
    activeProcesses.delete(pid)
  }
  stats.totalKilled += killed
  stats.currentRunning = 0
  return killed
}

function getWindowsResourceUsage(pid: number): ResourceUsage {
  const usage: ResourceUsage = { pid, timestamp: Date.now() }

  try {
    const { execSync } = require("child_process")
    const result = execSync(
      `powershell -NoLogo -NoProfile -Command "Get-Process -Id ${pid} | Select-Object WorkingSet64, CPU, ReadTransferCount, WriteTransferCount | ConvertTo-Json -Compress"`,
      { encoding: "utf8", timeout: 5000 },
    )
    const json = JSON.parse(result.trim())
    if (json) {
      if (json.WorkingSet64) {
        usage.memoryMB = Math.round(json.WorkingSet64 / 1024 / 1024)
      }
      if (json.CPU != null) {
        usage.cpuPercent = Math.round(json.CPU * 100) / 100
      }
      if (json.ReadTransferCount) {
        usage.ioReadBytes = Number(json.ReadTransferCount)
      }
      if (json.WriteTransferCount) {
        usage.ioWriteBytes = Number(json.WriteTransferCount)
      }
    }
  } catch (error) {
    log.warn("failed to get windows resource usage", { pid, error })
  }

  return usage
}

export function getResourceUsage(pid: number): ResourceUsage {
  const usage: ResourceUsage = { pid, timestamp: Date.now() }

  try {
    if (process.platform === "win32") {
      return getWindowsResourceUsage(pid)
    }

    const fs = require("fs")
    const stat = fs.readFileSync(`/proc/${pid}/status`, "utf8")
    const vmRss = stat.match(/VmRSS:\s+(\d+)\s+kB/)
    if (vmRss) {
      usage.memoryMB = parseInt(vmRss[1]!, 10) / 1024
    }

    const ioPath = `/proc/${pid}/io`
    if (fs.existsSync(ioPath)) {
      const ioData = fs.readFileSync(ioPath, "utf8")
      const readBytes = ioData.match(/read_bytes:\s+(\d+)/)
      const writeBytes = ioData.match(/write_bytes:\s+(\d+)/)
      if (readBytes) {
        usage.ioReadBytes = parseInt(readBytes[1]!, 10)
      }
      if (writeBytes) {
        usage.ioWriteBytes = parseInt(writeBytes[1]!, 10)
      }
    }
  } catch (error) {
    log.warn("failed to get resource usage", { pid, error })
  }

  return usage
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProcessSandbox") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      spawn: (command: string, options?: ProcessSandboxOptions) =>
        Effect.promise(() => spawnWithSandbox(command, options)),
      spawnBatch: (commands: string[], options?: BatchSandboxOptions) =>
        Effect.promise(() => spawnBatchWithSandbox(commands, options)),
      kill: (pid: number) => Effect.succeed(killProcessByPid(pid)),
      killAll: Effect.sync(() => killAllProcesses()),
      getStats: Effect.succeed(getSandboxStats()),
      getUsage: (pid: number) => Effect.succeed(getResourceUsage(pid)),
    })
  }),
)

export const defaultLayer = layer

export * as ProcessSandbox from "./process-sandbox"
