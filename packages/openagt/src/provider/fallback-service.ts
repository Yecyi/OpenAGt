import { Effect, Layer, Context, Option } from "effect"
import z from "zod"
import { Provider } from "@/provider"
import { Config } from "@/config"
import { Log } from "@/util"
import { ModelID, ProviderID } from "./schema"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"

const log = Log.create({ service: "provider.fallback" })

export interface FallbackEntry {
  provider: string
  model: string
}

export interface FallbackState {
  baseProviderID: string
  baseModelID: string
  chain: FallbackEntry[]
  index: number
  attempts: number
  maxRetries: number
  retryOnRateLimit: boolean
  retryOnServerError: boolean
}

export interface Interface {
  readonly createState: (providerID: string, modelID: string) => Effect.Effect<FallbackState | undefined>
  readonly next: (state: FallbackState) => Effect.Effect<{ model: Provider.Model; state: FallbackState } | undefined>
  readonly shouldFallback: (error: unknown, state: FallbackState) => Effect.Effect<boolean>
  /** Get fallback metrics for observability */
  readonly getMetrics: () => FallbackMetrics
  /** Record an attempt for metrics */
  readonly recordAttempt: (provider: string, success: boolean) => void
  /** Reset metrics */
  readonly resetMetrics: () => void
}

export interface FallbackMetrics {
  totalAttempts: number
  totalFallbacks: number
  fallbackRate: number
  fallbackByReason: Record<string, number>
  fallbackByProvider: Record<string, number>
  hopLatencies: number[]
  providerErrors: Record<string, number>
  lastFallback?: z.infer<typeof BusEvent.FallbackHopEvent.properties>
}

function createMetrics(): FallbackMetrics {
  return {
    totalAttempts: 0,
    totalFallbacks: 0,
    fallbackRate: 0,
    fallbackByReason: {},
    fallbackByProvider: {},
    hopLatencies: [],
    providerErrors: {},
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProviderFallback") {}

type ParsedError = {
  statusCode?: number
  message: string
  reason?: string
}

export const layer: Layer.Layer<Service, never, Config.Service | Provider.Service | Bus.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const bus = yield* Bus.Service
    const runtimeState = {
      metrics: createMetrics(),
      hopStartTime: null as number | null,
    }

    const createState: Interface["createState"] = Effect.fn("ProviderFallback.createState")(function* (
      providerID: string,
      modelID: string,
    ) {
      runtimeState.hopStartTime = Date.now()
      const cfg = yield* config.get()
      const fallback = cfg.provider?.[providerID]?.fallback
      if (!fallback?.enabled) return undefined

      const normalized =
        fallback.chain && fallback.chain.length > 0
          ? fallback.chain
              .filter((item) => item.provider.trim() && item.model.trim())
              .map((item) => ({
                provider: item.provider.trim(),
                model: item.model.trim(),
              }))
          : fallback.provider && fallback.model
            ? [{ provider: fallback.provider.trim(), model: fallback.model.trim() }]
            : []
      if (normalized.length === 0) return undefined

      return {
        baseProviderID: providerID,
        baseModelID: modelID,
        chain: normalized,
        index: -1,
        attempts: 0,
        maxRetries: fallback.maxRetries ?? 3,
        retryOnRateLimit: fallback.retryOnRateLimit ?? true,
        retryOnServerError: fallback.retryOnServerError ?? true,
      }
    })

    const next: Interface["next"] = Effect.fn("ProviderFallback.next")(function* (fallbackState: FallbackState) {
      if (fallbackState.attempts >= fallbackState.maxRetries) return undefined

      let index = fallbackState.index + 1
      let attempts = fallbackState.attempts
      while (index < fallbackState.chain.length && attempts < fallbackState.maxRetries) {
        const entry = fallbackState.chain[index]
        const fallbackModel = yield* provider
          .getModel(ProviderID.make(entry.provider), ModelID.make(entry.model))
          .pipe(Effect.option)
        attempts += 1
        if (Option.isSome(fallbackModel)) {
          const nextState: FallbackState = { ...fallbackState, index, attempts }
          const hopEvent: z.infer<typeof BusEvent.FallbackHopEvent.properties> = {
            from: { provider: fallbackState.baseProviderID, model: fallbackState.baseModelID },
            to: { provider: entry.provider, model: entry.model },
            attempt: nextState.attempts,
          }

          // Update metrics
          runtimeState.metrics.totalFallbacks++
          runtimeState.metrics.fallbackByProvider[`${entry.provider}/${entry.model}`] =
            (runtimeState.metrics.fallbackByProvider[`${entry.provider}/${entry.model}`] ?? 0) + 1
          runtimeState.metrics.lastFallback = hopEvent

          // Record hop latency
          if (runtimeState.hopStartTime !== null) {
            const latencyMs = Date.now() - runtimeState.hopStartTime
            runtimeState.metrics.hopLatencies.push(latencyMs)
            if (runtimeState.metrics.hopLatencies.length > 100) {
              runtimeState.metrics.hopLatencies = runtimeState.metrics.hopLatencies.slice(-100)
            }
            runtimeState.hopStartTime = Date.now()
          }

          // Emit fallback hop event to Bus for observability
          yield* bus.publish(BusEvent.FallbackHopEvent, hopEvent)

          log.info("provider.fallback.hop", {
            from: `${fallbackState.baseProviderID}/${fallbackState.baseModelID}`,
            to: `${entry.provider}/${entry.model}`,
            attempt: nextState.attempts,
            totalAttempts: nextState.attempts,
            chainLength: fallbackState.chain.length,
          })

          return { model: fallbackModel.value, state: nextState }
        }
        log.warn("fallback model unavailable", { provider: entry.provider, model: entry.model })
        index += 1
      }
      return undefined
    })

    const shouldFallback: Interface["shouldFallback"] = Effect.fn("ProviderFallback.shouldFallback")(function* (
      error: unknown,
      fallbackState: FallbackState,
    ) {
      const parsed = parseError(error)
      if (!parsed) return false

      let shouldRetry = false
      if (parsed.statusCode === 429) {
        shouldRetry = fallbackState.retryOnRateLimit
        if (shouldRetry) {
          runtimeState.metrics.fallbackByReason["rate_limit"] = (runtimeState.metrics.fallbackByReason["rate_limit"] ?? 0) + 1
        }
      } else if (parsed.statusCode !== undefined && parsed.statusCode >= 500 && parsed.statusCode < 600) {
        shouldRetry = fallbackState.retryOnServerError
        if (shouldRetry) {
          runtimeState.metrics.fallbackByReason[`server_error_${parsed.statusCode}`] =
            (runtimeState.metrics.fallbackByReason[`server_error_${parsed.statusCode}`] ?? 0) + 1
        }
      }

      if (!shouldRetry) {
        if (parsed.message.includes("rate limit")) {
          shouldRetry = fallbackState.retryOnRateLimit
          if (shouldRetry) {
            runtimeState.metrics.fallbackByReason["rate_limit"] = (runtimeState.metrics.fallbackByReason["rate_limit"] ?? 0) + 1
          }
        }
        if (parsed.message.includes("too many requests")) {
          shouldRetry = fallbackState.retryOnRateLimit
          if (shouldRetry) {
            runtimeState.metrics.fallbackByReason["rate_limit"] = (runtimeState.metrics.fallbackByReason["rate_limit"] ?? 0) + 1
          }
        }
        if (parsed.message.includes("overloaded")) {
          shouldRetry = fallbackState.retryOnServerError
          if (shouldRetry) {
            runtimeState.metrics.fallbackByReason["overloaded"] = (runtimeState.metrics.fallbackByReason["overloaded"] ?? 0) + 1
          }
        }
      }

      return shouldRetry
    })

    const getMetrics: Interface["getMetrics"] = () => {
      const metrics = {
        ...runtimeState.metrics,
        fallbackRate:
          runtimeState.metrics.totalAttempts === 0
            ? 0
            : Math.round((runtimeState.metrics.totalFallbacks / runtimeState.metrics.totalAttempts) * 100 * 100) / 100,
        fallbackByReason: { ...runtimeState.metrics.fallbackByReason },
        fallbackByProvider: { ...runtimeState.metrics.fallbackByProvider },
        hopLatencies: [...runtimeState.metrics.hopLatencies],
        providerErrors: { ...runtimeState.metrics.providerErrors },
      }
      return metrics
    }

    const recordAttempt: Interface["recordAttempt"] = (provider: string, success: boolean) => {
      runtimeState.metrics.totalAttempts++
      if (!success) {
        runtimeState.metrics.providerErrors[provider] = (runtimeState.metrics.providerErrors[provider] ?? 0) + 1
      }
    }

    const resetMetricsFn: Interface["resetMetrics"] = () => {
      runtimeState.metrics = createMetrics()
      runtimeState.hopStartTime = null
    }

    return Service.of({ createState, next, shouldFallback, getMetrics: getMetrics, recordAttempt, resetMetrics: resetMetricsFn })
  }),
)

function parseError(error: unknown): ParsedError | undefined {
  if (!isRecord(error)) return undefined
  const data = isRecord(error.data) ? error.data : error
  const statusCode = typeof data.statusCode === "number" ? data.statusCode : undefined
  const message =
    typeof data.message === "string"
      ? data.message.toLowerCase()
      : typeof error.message === "string"
        ? error.message.toLowerCase()
        : ""
  if (statusCode === undefined && !message) return undefined
  return { statusCode, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(Provider.defaultLayer), Layer.provide(Bus.layer)),
)

export * as ProviderFallback from "./fallback-service"
