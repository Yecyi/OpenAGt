/**
 * Process Sandbox - Subprocess Resource Limiter
 *
 * Provides subprocess-level resource limits and bounded IO collection.
 * The limits are best-effort and mainly affect Node/Bun-based subprocesses.
 */

import { spawn } from "bun"
import { Effect, Layer, Context } from "effect"
import { spawn as nodeSpawn } from "child_process"

type BunChildProcess = {
  pid?: number
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
  shell?: string
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

const DEFAULT_CMD = "C:\\WINDOWS\\system32\\cmd.exe"
const DEFAULT_POWERSHELL = "powershell.exe"

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

function shellKind(shell?: string) {
  if (process.platform !== "win32") return "posix" as const
  const lower = shell?.toLowerCase()
  if (!lower) return "cmd" as const
  if (lower.includes("powershell") || lower.includes("pwsh")) return "powershell" as const
  return "cmd" as const
}

function buildArgs(command: string, shell?: string): [string, string[]] {
  if (process.platform === "win32") {
    if (shellKind(shell) === "powershell") {
      return [shell || DEFAULT_POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]]
    }
    return [shell || DEFAULT_CMD, ["/d", "/s", "/c", command]]
  }
  return [shell || "/bin/sh", ["-c", command]]
}

function applyResourceLimits(options: ProcessSandboxOptions): Record<string, string> {
  const env: Record<string, string> = {}
  const existingNodeOptions = options.env?.NODE_OPTIONS?.trim()
  const limits = options.limits
  const nodeOptions = [existingNodeOptions].filter(Boolean)

  if (limits?.maxMemory) {
    nodeOptions.push(`--max-old-space-size=${Math.max(1, Math.floor(limits.maxMemory / 1024 / 1024))}`)
  }

  if (limits?.maxStack) {
    nodeOptions.push(`--stack-size=${Math.max(1, Math.floor(limits.maxStack / 1024))}`)
  }

  if (nodeOptions.length > 0) {
    env.NODE_OPTIONS = nodeOptions.join(" ")
  }

  return env
}

async function collectStream(stream: ReadableStream<Uint8Array> | null, maxSize?: number) {
  if (!stream) {
    return { text: "", truncated: false }
  }

  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let total = 0
  let truncated = false

  while (true) {
    const next = await reader.read().catch(() => ({ done: true, value: undefined }))
    if (next.done || !next.value) break

    const chunk = next.value
    if (!maxSize) {
      chunks.push(chunk)
      continue
    }

    const remaining = maxSize - total
    if (remaining <= 0) {
      truncated = true
      continue
    }

    if (chunk.byteLength > remaining) {
      chunks.push(chunk.slice(0, remaining))
      total += remaining
      truncated = true
      continue
    }

    chunks.push(chunk)
    total += chunk.byteLength
  }

  return {
    text: new TextDecoder().decode(Bun.concatArrayBuffers(chunks)),
    truncated,
  }
}

async function killProcessTree(pid: number | undefined) {
  if (!pid) return

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = nodeSpawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("exit", () => resolve())
      killer.once("error", () => resolve())
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
  const { timeoutMs = 30000, cwd = process.cwd(), env = process.env as Record<string, string>, limits, shell } = options

  stats.totalSpawned++
  stats.currentRunning++

  const [cmd, args] = buildArgs(command, shell)
  const mergedEnv = { ...env, ...applyResourceLimits(options) }

  let timedOut = false
  let killed = false

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

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            killed = true
            stats.totalTimeouts++
            stats.totalKilled++
            void killProcessTree(child.pid).finally(() => child.kill())
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
        })
      })
  })
}

export function spawnWithSandboxSync(command: string, options: ProcessSandboxOptions = {}): ProcessSandboxResult {
  const { timeoutMs = 30000, cwd = process.cwd(), env = process.env as Record<string, string>, limits, shell } = options

  stats.totalSpawned++
  stats.currentRunning++

  const { spawnSync } = require("child_process")
  const [cmd, args] = buildArgs(command, shell)
  const mergedEnv = { ...env, ...applyResourceLimits(options) }
  const result = spawnSync(cmd, args, {
    cwd,
    env: mergedEnv,
    timeout: timeoutMs,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })

  stats.currentRunning--

  const timedOut = result.signal === "SIGTERM" || result.signal === "SIGKILL" || !!result.error?.message?.includes("timed out")
  if (timedOut) stats.totalTimeouts++
  if (timedOut) stats.totalKilled++

  const truncate = (value: string) => {
    if (!limits?.maxFileSize || value.length <= limits.maxFileSize) {
      return { text: value, truncated: false }
    }
    return { text: value.slice(0, limits.maxFileSize), truncated: true }
  }

  const stdout = truncate(result.stdout ?? "")
  const stderr = truncate(result.stderr ?? (result.error ? String(result.error.message) : ""))

  return {
    stdout: stdout.text,
    stderr: stderr.text,
    exitCode: result.status,
    timedOut,
    killed: timedOut,
    outputTruncated: stdout.truncated || stderr.truncated,
  }
}

export interface BatchSandboxOptions extends ProcessSandboxOptions {
  maxConcurrent?: number
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
  } catch {}

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
  } catch {}

  return usage
}

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
