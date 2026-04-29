import type { Effect } from "effect"

export type BunChildProcess = {
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
  /** Maximum total bytes for stdout + stderr combined. Defaults to maxFileSize * 2 if maxFileSize is set. */
  maxOutputBytes?: number
}

export interface ProcessSandboxOptions {
  timeoutMs?: number
  limits?: ResourceLimits
  cwd?: string
  env?: Record<string, string>
  shell?: string
  /** Grace period (ms) before SIGKILL after SIGTERM. Default 2000ms. */
  killGraceMs?: number
}

export interface ProcessSandboxResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  killed: boolean
  outputTruncated?: boolean
  /** Whether output was truncated due to maxOutputBytes limit */
  outputBytesTruncated?: boolean
}

export interface ProcessSandboxStats {
  totalSpawned: number
  totalKilled: number
  totalTimeouts: number
  totalKilledByResourceLimit: number
  currentRunning: number
}

export interface BatchSandboxOptions extends ProcessSandboxOptions {
  maxConcurrent?: number
}

export interface ResourceUsage {
  pid: number
  memoryMB?: number
  cpuPercent?: number
  ioReadBytes?: number
  ioWriteBytes?: number
  timestamp: number
}

export interface Interface {
  readonly spawn: (command: string, options?: ProcessSandboxOptions) => Effect.Effect<ProcessSandboxResult>
  readonly spawnBatch: (commands: string[], options?: BatchSandboxOptions) => Effect.Effect<ProcessSandboxResult[]>
  readonly kill: (pid: number) => Effect.Effect<boolean>
  readonly killAll: Effect.Effect<number>
  readonly getStats: Effect.Effect<ProcessSandboxStats>
  readonly getUsage: (pid: number) => Effect.Effect<ResourceUsage>
}
