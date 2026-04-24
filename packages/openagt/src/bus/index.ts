import z from "zod"
import { Effect, Exit, Layer, PubSub, Scope, Context, Stream } from "effect"
import { EffectBridge } from "@/effect"
import { Log } from "../util"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { InstanceState } from "@/effect"
import { makeRuntime } from "@/effect/run-service"
import path from "path"
import os from "os"
import fs from "fs/promises"
import fsSync from "node:fs"

const log = Log.create({ service: "bus" })

/**
 * Critical event types that should be persisted to disk
 */
const CRITICAL_EVENT_TYPES = [
  "provider.fallback.hop",
  "tools.changed",
  "mcp.server.connected",
  "mcp.server.disconnected",
]

/**
 * Ring buffer for event persistence with bounded capacity.
 * Max capacity is configurable via the `OPENCODE_EVENT_BUFFER_SIZE` environment variable.
 */
const DEFAULT_EVENT_BUFFER_SIZE = 1000
const DEFAULT_EVENT_BUFFER_BYTES = 1024 * 1024

function getEventBufferSize(): number {
  const env = process.env.OPENCODE_EVENT_BUFFER_SIZE
  if (env) {
    const parsed = parseInt(env, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    log.warn("invalid OPENCODE_EVENT_BUFFER_SIZE, using default", { value: env })
  }
  return DEFAULT_EVENT_BUFFER_SIZE
}

function getEventBufferBytes(): number {
  const env = process.env.OPENCODE_EVENT_BUFFER_BYTES
  if (env) {
    const parsed = parseInt(env, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    log.warn("invalid OPENCODE_EVENT_BUFFER_BYTES, using default", { value: env })
  }
  return DEFAULT_EVENT_BUFFER_BYTES
}

class EventBuffer {
  private events: Array<{ timestamp: number; payload: unknown }> = []
  private maxCapacity: number
  private maxBytes: number
  private bufferPath: string | null = null
  private _droppedCount: number = 0

  constructor(maxCapacity: number = DEFAULT_EVENT_BUFFER_SIZE, maxBytes: number = DEFAULT_EVENT_BUFFER_BYTES) {
    this.maxCapacity = maxCapacity
    this.maxBytes = maxBytes
  }

  initialize(): void {
    try {
      const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
      const eventsDir = path.join(stateHome, "opencode", "events")
      fsSync.mkdirSync(eventsDir, { recursive: true })
      this.bufferPath = path.join(eventsDir, "events.jsonl")
    } catch (error) {
      log.warn("failed to initialize event buffer", { error })
    }
  }

  push(event: { timestamp: number; payload: unknown }): boolean {
    const eventType = (event.payload as any)?.type ?? ""
    const isCritical = CRITICAL_EVENT_TYPES.includes(eventType)

    // Backpressure: at 90% capacity, drop non-critical events
    if (this.events.length >= this.maxCapacity * 0.9 && !isCritical) {
      this._droppedCount++
      return false
    }

    this.events.push(event)
    if (this.events.length > this.maxCapacity) {
      this.events = this.events.slice(-this.maxCapacity)
    }
    return true
  }

  getDroppedCount(): number {
    return this._droppedCount
  }

  resetDroppedCount(): void {
    this._droppedCount = 0
  }

  getSize(): number {
    return this.events.length
  }

  getCapacity(): number {
    return this.maxCapacity
  }

  async persist(): Promise<void> {
    if (!this.bufferPath || this.events.length === 0) return
    try {
      const lines = this.events.map((e) => JSON.stringify(e)).join("\n") + "\n"
      await fs.appendFile(this.bufferPath, lines, "utf-8")
      this.events = []
      await this.compactDisk()
    } catch (error) {
      log.warn("failed to persist events", { error })
    }
  }

  getRecent(count: number = 100): Array<{ timestamp: number; payload: unknown }> {
    return this.events.slice(-count)
  }

  async replay(callback: (event: { timestamp: number; payload: unknown }) => void): Promise<void> {
    if (!this.bufferPath) return
    try {
      const lines = await this.readDiskWindow()
      for (const line of lines) {
        try {
          const event = JSON.parse(line)
          callback(event)
        } catch (error) {
          log.warn("failed to parse event line during replay", { error })
        }
      }
    } catch (error) {
      log.warn("failed to replay events from disk", { error })
    }
  }

  private async compactDisk(): Promise<void> {
    if (!this.bufferPath) return
    const stat = await fs.stat(this.bufferPath).catch(() => undefined)
    if (!stat || stat.size <= this.maxBytes) return
    await fs.writeFile(this.bufferPath, this.formatLines(await this.readDiskWindow()), "utf-8")
  }

  private async readDiskWindow(): Promise<string[]> {
    if (!this.bufferPath) return []
    const content = await fs.readFile(this.bufferPath, "utf-8")
    const lines = content
      .split("\n")
      .filter((line) => line.trim())
      .slice(-this.maxCapacity)
    while (lines.length > 1 && Buffer.byteLength(this.formatLines(lines), "utf-8") > this.maxBytes) {
      lines.shift()
    }
    return lines
  }

  private formatLines(lines: string[]): string {
    return lines.length ? lines.join("\n") + "\n" : ""
  }

  async clear(): Promise<void> {
    if (!this.bufferPath) return
    try {
      await fs.unlink(this.bufferPath)
    } catch (error) {
      log.warn("failed to clear event buffer", { error })
    }
  }
}

export const InstanceDisposed = BusEvent.define(
  "server.instance.disposed",
  z.object({
    directory: z.string(),
  }),
)

type Payload<D extends BusEvent.Definition = BusEvent.Definition> = {
  type: D["type"]
  properties: z.infer<D["properties"]>
}

type State = {
  wildcard: PubSub.PubSub<Payload>
  typed: Map<string, PubSub.PubSub<Payload>>
}

export interface Interface {
  readonly publish: <D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>,
  ) => Effect.Effect<void>
  readonly subscribe: <D extends BusEvent.Definition>(def: D) => Stream.Stream<Payload<D>>
  readonly subscribeAll: () => Stream.Stream<Payload>
  readonly subscribeCallback: <D extends BusEvent.Definition>(
    def: D,
    callback: (event: Payload<D>) => unknown,
  ) => Effect.Effect<() => void>
  readonly subscribeAllCallback: (callback: (event: any) => unknown) => Effect.Effect<() => void>
  readonly getRecentEvents: (count?: number) => Array<{ timestamp: number; payload: unknown }>
  readonly replayEvents: (callback: (event: { timestamp: number; payload: unknown }) => void) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Bus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const eventBuffer = new EventBuffer(getEventBufferSize(), getEventBufferBytes())
    eventBuffer.initialize()

    const state = yield* InstanceState.make<State>(
      Effect.fn("Bus.state")(function* (ctx) {
        const wildcard = yield* PubSub.unbounded<Payload>()
        const typed = new Map<string, PubSub.PubSub<Payload>>()

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // Publish InstanceDisposed before shutting down so subscribers see it
            yield* PubSub.publish(wildcard, {
              type: InstanceDisposed.type,
              properties: { directory: ctx.directory },
            })
            yield* PubSub.shutdown(wildcard)
            for (const ps of typed.values()) {
              yield* PubSub.shutdown(ps)
            }
            yield* Effect.promise(() => eventBuffer.persist())
          }),
        )

        return { wildcard, typed }
      }),
    )

    function getOrCreate<D extends BusEvent.Definition>(state: State, def: D) {
      return Effect.gen(function* () {
        let ps = state.typed.get(def.type)
        if (!ps) {
          ps = yield* PubSub.unbounded<Payload>()
          state.typed.set(def.type, ps)
        }
        return ps as unknown as PubSub.PubSub<Payload<D>>
      })
    }

    function publish<D extends BusEvent.Definition>(def: D, properties: z.output<D["properties"]>) {
      return Effect.gen(function* () {
        const s = yield* InstanceState.get(state)
        const payload: Payload = { type: def.type, properties }
        log.info("publishing", { type: def.type })

        // Persist critical events to buffer; log if dropped due to backpressure
        if (CRITICAL_EVENT_TYPES.includes(def.type)) {
          const pushed = eventBuffer.push({ timestamp: Date.now(), payload })
          if (!pushed) {
            log.warn("event dropped due to backpressure", { type: def.type })
          }
        }

        const ps = s.typed.get(def.type)
        if (ps) yield* PubSub.publish(ps, payload)
        yield* PubSub.publish(s.wildcard, payload)

        const dir = yield* InstanceState.directory
        const context = yield* InstanceState.context
        const workspace = yield* InstanceState.workspaceID

        GlobalBus.emit("event", {
          directory: dir,
          project: context.project.id,
          workspace,
          payload,
        })
      })
    }

    function subscribe<D extends BusEvent.Definition>(def: D): Stream.Stream<Payload<D>> {
      log.info("subscribing", { type: def.type })
      return Stream.unwrap(
        Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          const ps = yield* getOrCreate(s, def)
          return Stream.fromPubSub(ps)
        }),
      ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: def.type }))))
    }

    function subscribeAll(): Stream.Stream<Payload> {
      log.info("subscribing", { type: "*" })
      return Stream.unwrap(
        Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return Stream.fromPubSub(s.wildcard)
        }),
      ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: "*" }))))
    }

    function on<T>(pubsub: PubSub.PubSub<T>, type: string, callback: (event: T) => unknown) {
      return Effect.gen(function* () {
        log.info("subscribing", { type })
        const bridge = yield* EffectBridge.make()
        const scope = yield* Scope.make()
        const subscription = yield* Scope.provide(scope)(PubSub.subscribe(pubsub))

        yield* Scope.provide(scope)(
          Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((msg) =>
              Effect.tryPromise({
                try: () => Promise.resolve().then(() => callback(msg)),
                catch: (cause) => {
                  log.error("subscriber failed", { type, cause })
                },
              }).pipe(Effect.ignore),
            ),
            Effect.forkScoped,
          ),
        )

        return () => {
          log.info("unsubscribing", { type })
          bridge.fork(Scope.close(scope, Exit.void))
        }
      })
    }

    const subscribeCallback = Effect.fn("Bus.subscribeCallback")(function* <D extends BusEvent.Definition>(
      def: D,
      callback: (event: Payload<D>) => unknown,
    ) {
      const s = yield* InstanceState.get(state)
      const ps = yield* getOrCreate(s, def)
      return yield* on(ps, def.type, callback)
    })

    const subscribeAllCallback = Effect.fn("Bus.subscribeAllCallback")(function* (callback: (event: any) => unknown) {
      const s = yield* InstanceState.get(state)
      return yield* on(s.wildcard, "*", callback)
    })

    const getRecentEventsFn = (count?: number) => eventBuffer.getRecent(count)
    const replayEventsFn = (callback: (event: { timestamp: number; payload: unknown }) => void) =>
      Effect.promise(() => eventBuffer.replay(callback))

    return Service.of({
      publish,
      subscribe,
      subscribeAll,
      subscribeCallback,
      subscribeAllCallback,
      getRecentEvents: getRecentEventsFn,
      replayEvents: replayEventsFn,
    })
  }),
)

export const defaultLayer = layer

const { runPromise, runSync } = makeRuntime(Service, layer)

// runSync is safe here because the subscribe chain (InstanceState.get, PubSub.subscribe,
// Scope.make, Effect.forkScoped) is entirely synchronous. If any step becomes async, this will throw.
export async function publish<D extends BusEvent.Definition>(def: D, properties: z.output<D["properties"]>) {
  return runPromise((svc) => svc.publish(def, properties))
}

export function subscribe<D extends BusEvent.Definition>(
  def: D,
  callback: (event: { type: D["type"]; properties: z.infer<D["properties"]> }) => unknown,
) {
  return runSync((svc) => svc.subscribeCallback(def, callback))
}

export function subscribeAll(callback: (event: any) => unknown) {
  return runSync((svc) => svc.subscribeAllCallback(callback))
}

export * as Bus from "."
