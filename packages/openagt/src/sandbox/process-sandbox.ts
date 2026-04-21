/**
 * Process Sandbox - Subprocess Resource Limiter
 *
 * Provides subprocess-level resource limits using Node.js/Bun process limits.
 * This complements the existing sandbox module with additional resource controls.
 */

import { spawn } from "bun"
import { Effect, Layer, Context } from "effect"

type BunChildProcess = {
  kill: () => void
  exited: Promise<number>
  stdout: ReadableStream<Uint8Array> | null
  stderr: ReadableStream<Uint8Array> | null
}

export interface ResourceLimits {
  maxMemory?: number
  maxFileSize?: number
  maxStack?: number
}

export interface ProcessSandboxOptions {
  timeoutMs?: number
  limits?: ResourceLimits
  cwd?: string
  env?: Record<string, string>
}

export interface ProcessSandboxResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  killed: boolean
  outputTruncated?: boolean
}

export interface ProcessSandboxStats {
  totalSpawned: number
  totalKilled: number
  totalTimeouts: number
  currentRunning: number
}

// ============================================================
// Statistics Tracking
// ============================================================

const stats: ProcessSandboxStats = {
  totalSpawned: 0,
  totalKilled: 0,
  totalTimeouts: 0,
  currentRunning: 0,
}

export function getSandboxStats(): ProcessSandboxStats {
  return { ...stats }
}

export function resetSandboxStats(): void {
  stats.totalSpawned = 0
  stats.totalKilled = 0
  stats.totalTimeouts = 0
  stats.currentRunning = 0
}

// ============================================================
// Process Spawn with Limits
// ============================================================

function buildArgs(command: string, shell?: string): [string, string[]] {
  if (process.platform === "win32") {
    const shellName = shell?.toLowerCase() || "cmd"
    if (shellName.includes("powershell") || shellName.includes("pwsh")) {
      return [shell || "powershell", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]]
    }
    return ["C:\\WINDOWS\\system32\\cmd.exe", ["/d", "/s", "/c", command]]
  }
  return [shell || "/bin/sh", ["-c", command]]
}

function applyResourceLimits(options: ProcessSandboxOptions): Record<string, string> {
  const env: Record<string, string> = {}
  const limits = options.limits

  if (limits?.maxMemory) {
    const maxMemoryMB = Math.floor((limits.maxMemory ?? 0) / 1024 / 1024)
    if (process.platform === "win32") {
      env.NODE_OPTIONS = `--max-old-space-size=${maxMemoryMB}`
    } else {
      env.NODE_OPTIONS = `--max-old-space-size=${maxMemoryMB}`
    }
  }

  if (limits?.maxStack) {
    const maxStackKB = Math.floor((limits.maxStack ?? 0) / 1024)
    env.NODE_OPTIONS = `${env.NODE_OPTIONS || ""} --stack-size=${maxStackKB}`.trim()
  }

  return env
}

async function killProcess(pid: number | undefined): Promise<void> {
  if (!pid) return
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn({
        cmd: ["taskkill", "/pid", String(pid), "/f", "/t"],
        stderr: "inherit",
      })
      killer.exited.then(() => resolve())
    })
    return
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
  }
}

export async function spawnWithSandbox(
  command: string,
  options: ProcessSandboxOptions = {},
): Promise<ProcessSandboxResult> {
  const { timeoutMs = 30000, cwd = process.cwd(), env = process.env, limits } = options

  stats.totalSpawned++
  stats.currentRunning++

  const [cmd, args] = buildArgs(command)

  // Apply resource limits to environment
  const resourceEnv = applyResourceLimits({ ...options, limits })
  const mergedEnv = { ...env, ...resourceEnv }

  let timedOut = false
  let killed = false
  let stdoutData = ""
  let stderrData = ""
  let outputTruncated = false

  return new Promise<ProcessSandboxResult>((resolve) => {
    const child = spawn({
      cmd: args.length > 0 ? [cmd, ...args] : [cmd, "-c", command],
      cwd,
      env: {
        ...env,
        ...(limits?.maxMemory
          ? { NODE_OPTIONS: `--max-old-space-size=${Math.floor((limits.maxMemory ?? 0) / 1024 / 1024)}` }
          : {}),
      },
      stderr: "pipe",
      stdout: "pipe",
      stdin: "ignore",
    })

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            stats.totalTimeouts++
            child.kill()
          }, timeoutMs)
        : undefined

    const processStream = async (
      stream: ReadableStream<Uint8Array> | null,
      collector: string[],
      maxSize?: number,
    ) => {
      if (!stream) return
      const reader = stream.getReader()
      let totalSize = 0
      while (true) {
        const next = await reader.read().catch(() => ({ done: true, value: undefined }))
        if (next.done || !next.value) break

        const chunk = next.value
        totalSize += chunk.byteLength

        if (maxSize && totalSize > maxSize) {
          collector.push(new TextDecoder().decode(chunk.slice(0, maxSize - totalSize + chunk.byteLength)))
          outputTruncated = true
          reader.releaseLock()
          break
        }

        collector.push(new TextDecoder().decode(chunk))
      }
    }

    const maxFileSizeBytes = limits?.maxFileSize
    const stdoutPromise = processStream(child.stdout, [], maxFileSizeBytes)
    const stderrPromise = processStream(child.stderr, [], maxFileSizeBytes)

    child.exited
      .then((exitCode) => {
        if (timer) clearTimeout(timer)
        stats.currentRunning--

        Promise.all([stdoutPromise, stderrPromise]).then(() => {
          resolve({
            stdout: stdoutData,
            stderr: stderrData,
            exitCode,
            timedOut,
            killed,
            outputTruncated,
          })
        })
      })
      .catch((error) => {
        if (timer) clearTimeout(timer)
        stats.currentRunning--
        resolve({
          stdout: stdoutData,
          stderr: String(error),
          exitCode: -1,
          timedOut,
          killed,
        })
      })
  })
}

export function spawnWithSandboxSync(command: string, options: ProcessSandboxOptions = {}): ProcessSandboxResult {
  const { timeoutMs = 30000, cwd = process.cwd(), env = process.env } = options

  stats.totalSpawned++
  stats.currentRunning++

  const { execSync } = require("child_process")
  let stdout = ""
  let stderr = ""
  let exitCode: number | null = null
  let timedOut = false

  try {
    const result = execSync(command, {
      cwd,
      env,
      timeout: timeoutMs,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    stdout = result
  } catch (error: unknown) {
    if (error && typeof error === "object" && "status" in error) {
      exitCode = (error as { status: number }).status
      if ((error as { killed?: boolean }).killed) {
        timedOut = true
        stats.totalTimeouts++
      }
    }
    if (error && typeof error === "object" && "stderr" in error) {
      stderr = String((error as { stderr: unknown }).stderr)
    }
  }

  stats.currentRunning--

  return {
    stdout,
    stderr,
    exitCode,
    timedOut,
    killed: false,
  }
}

// ============================================================
// Batch Process Execution
// ============================================================

export interface BatchSandboxOptions extends ProcessSandboxOptions {
  maxConcurrent?: number
}

export async function spawnBatchWithSandbox(
  commands: string[],
  options: BatchSandboxOptions = {},
): Promise<ProcessSandboxResult[]> {
  const { maxConcurrent = 4, ...rest } = options

  const results: ProcessSandboxResult[] = []
  const queue = [...commands]
  const running: Promise<void>[] = []

  while (queue.length > 0 || running.length > 0) {
    while (running.length < maxConcurrent && queue.length > 0) {
      const cmd = queue.shift()!
      const promise = spawnWithSandbox(cmd, rest).then((result) => {
        results.push(result)
        running.splice(running.indexOf(promise), 1)
      })
      running.push(promise)
    }

    if (running.length > 0) {
      await Promise.race(running)
    }
  }

  await Promise.all(running)
  return results
}

// ============================================================
// Kill Management
// ============================================================

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
  if (process) {
    process.kill()
    stats.totalKilled++
    return true
  }
  return false
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

// ============================================================
// Resource Monitor
// ============================================================

export interface ResourceUsage {
  pid: number
  memoryMB?: number
  cpuPercent?: number
}

export interface ResourceUsage {
  pid: number
  memoryMB?: number
  cpuPercent?: number
  timestamp: number
}

function getWindowsResourceUsage(pid: number): ResourceUsage {
  const usage: ResourceUsage = { pid, timestamp: Date.now() }

  try {
    const { execSync } = require("child_process")
    const result = execSync(
      `powershell -NoLogo -NoProfile -Command "Get-Process -Id ${pid} | Select-Object WorkingSet64 | ConvertTo-Json -Compress"`,
      { encoding: "utf8", timeout: 5000 },
    )
    const json = JSON.parse(result.trim())
    if (json && json.WorkingSet64) {
      usage.memoryMB = Math.round(json.WorkingSet64 / 1024 / 1024)
    }
  } catch {
    // Process might have exited or not be accessible
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
  } catch {
    // Process might have exited
  }

  return usage
}

// ============================================================
// Effect-based Service
// ============================================================

export interface Interface {
  readonly spawn: (command: string, options?: ProcessSandboxOptions) => Effect.Effect<ProcessSandboxResult>
  readonly spawnBatch: (commands: string[], options?: BatchSandboxOptions) => Effect.Effect<ProcessSandboxResult[]>
  readonly kill: (pid: number) => Effect.Effect<boolean>
  readonly killAll: Effect.Effect<number>
  readonly getStats: Effect.Effect<ProcessSandboxStats>
  readonly getUsage: (pid: number) => Effect.Effect<ResourceUsage>
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
