import { Effect, Layer, Context } from "effect"
import { type Provider } from "@/provider"
import { Log } from "@/util"

type Model = Provider.Model

export interface FallbackEntry {
  providerID: string
  modelID: string
}

export interface FallbackConfig {
  enabled: boolean
  chain: FallbackEntry[]
  maxRetries: number
  retryOnRateLimit: boolean
  retryOnServerError: boolean
}

export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  enabled: true,
  chain: [],
  maxRetries: 3,
  retryOnRateLimit: true,
  retryOnServerError: true,
}

export function isRetryableError(error: unknown): boolean {
  if (!isRecord(error)) return false
  const data = (error as any).data
  if (!isRecord(data)) return false
  const status = data.statusCode
  const msg = typeof data.message === "string" ? data.message.toLowerCase() : ""
  if (status === 429) return true
  if (status === 500 || status === 502 || status === 503 || status === 504) return true
  if (msg.includes("rate limit") || msg.includes("overloaded")) return true
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function shouldFallback(error: unknown, config: FallbackConfig): boolean {
  if (!config.enabled) return false
  if (!isRetryableError(error)) return false
  return true
}

export function getNextFallback(currentIndex: number, config: FallbackConfig): FallbackEntry | undefined {
  if (currentIndex >= config.chain.length - 1) return undefined
  return config.chain[currentIndex + 1]
}

export interface FallbackState {
  currentIndex: number
  attempts: number
  lastError?: unknown
}

export function createFallbackState(): FallbackState {
  return { currentIndex: 0, attempts: 0 }
}

export function recordFallbackAttempt(state: FallbackState, error: unknown): FallbackState {
  return {
    currentIndex: state.currentIndex,
    attempts: state.attempts + 1,
    lastError: error,
  }
}

export function advanceFallback(state: FallbackState, config: FallbackConfig): FallbackState | null {
  const next = getNextFallback(state.currentIndex, config)
  if (!next) return null
  return {
    currentIndex: state.currentIndex + 1,
    attempts: 0,
    lastError: undefined,
  }
}

export function canRetry(state: FallbackState, config: FallbackConfig): boolean {
  return state.attempts < config.maxRetries
}
