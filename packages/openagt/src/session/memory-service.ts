/**
 * Session Memory Service
 *
 * Effect-based service that integrates memory.ts into the session lifecycle.
 * Provides automatic memory initialization and update based on token/tool call thresholds.
 */

import { Effect, Layer, Context } from "effect"
import {
  SessionMemory,
  loadMemory,
  saveMemory,
  updateMemory,
  deleteMemory,
  memoryExists,
  shouldInitializeMemory,
  shouldUpdateMemory,
  estimateMessageTokens,
  countToolCalls,
  parseMemorySections,
  SESSION_MEMORY_TEMPLATE,
  type MemoryConfig,
  type MemorySections,
} from "./memory"
import { SessionID } from "./schema"
import { Log } from "@/util"
import os from "os"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "SessionMemoryService" })

// ============================================================
// Snapshot Persistence
// ============================================================

function getSnapshotPath(sessionID: SessionID): string {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  return path.join(stateHome, "opencode", "sessions", sessionID, "memory-state.json")
}

async function loadSnapshot(sessionID: SessionID): Promise<MemoryState | null> {
  const snapshotPath = getSnapshotPath(sessionID)
  try {
    const data = await fs.readFile(snapshotPath, "utf8")
    return JSON.parse(data) as MemoryState
  } catch {
    return null
  }
}

async function saveSnapshot(state: MemoryState): Promise<void> {
  const snapshotPath = getSnapshotPath(state.sessionID)
  try {
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true })
    await fs.writeFile(snapshotPath, JSON.stringify(state), "utf8")
  } catch (err) {
    log.warn("failed to save memory snapshot", { sessionID: state.sessionID, error: String(err) })
  }
}

// ============================================================
// Types
// ============================================================

export interface MemoryState {
  sessionID: SessionID
  initialized: boolean
  lastTokenCount: number
  lastToolCallCount: number
  lastUpdated: number
  content: string | null
}

export interface MemoryUpdate {
  title?: string
  currentState?: string
  taskSpec?: string
  filesAndFunctions?: string
  workflow?: string
  errorsAndCorrections?: string
  learnings?: string
}

export interface SessionContext {
  sessionID: SessionID
  messages: Array<{ tokens?: { input?: number; output?: number }; parts?: Array<{ type?: string }> }>
}

export interface Interface {
  readonly getState: (sessionID: SessionID) => Effect.Effect<MemoryState | null>
  readonly initialize: (sessionID: SessionID) => Effect.Effect<MemoryState>
  readonly update: (sessionID: SessionID, updates: MemoryUpdate) => Effect.Effect<string>
  readonly shouldSave: (ctx: SessionContext) => Effect.Effect<boolean>
  readonly save: (ctx: SessionContext, updates: MemoryUpdate) => Effect.Effect<string>
  readonly delete: (sessionID: SessionID) => Effect.Effect<void>
  readonly getContent: (sessionID: SessionID) => Effect.Effect<string | null>
  readonly parseContent: (content: string) => MemorySections
}

// ============================================================
// Service Implementation
// ============================================================

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionMemory") {}

const memoryStates = new Map<string, MemoryState>()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const getState = Effect.fn("SessionMemory.getState")(function* (sessionID: SessionID) {
      return memoryStates.get(sessionID) ?? null
    })

    const initialize = Effect.fn("SessionMemory.initialize")(function* (sessionID: SessionID) {
      const existing = memoryStates.get(sessionID)
      if (existing?.initialized) {
        return existing
      }

      // Try restoring from snapshot first (crash recovery)
      const snapshot = yield* Effect.promise(() => loadSnapshot(sessionID))
      if (snapshot) {
        memoryStates.set(sessionID, snapshot)
        log.info("memory restored from snapshot", { sessionID })
        return snapshot
      }

      const content = yield* Effect.promise(() => loadMemory(sessionID))
      const state: MemoryState = {
        sessionID,
        initialized: true,
        lastTokenCount: 0,
        lastToolCallCount: 0,
        lastUpdated: Date.now(),
        content,
      }
      memoryStates.set(sessionID, state)
      log.debug("memory initialized", { sessionID })
      return state
    })

    const update = Effect.fn("SessionMemory.update")(function* (sessionID: SessionID, updates: MemoryUpdate) {
      const state = memoryStates.get(sessionID)
      if (!state?.initialized) {
        yield* initialize(sessionID)
      }

      const result = yield* Effect.promise(() => updateMemory(sessionID, updates))

      const currentState = memoryStates.get(sessionID)
      if (currentState) {
        currentState.content = result
        currentState.lastUpdated = Date.now()
        // Persist snapshot asynchronously so it doesn't block the hot path
        void Effect.promise(() => saveSnapshot(currentState)).pipe(Effect.ignore)
      }

      log.debug("memory updated", { sessionID, updates: Object.keys(updates) })
      return result
    })

    const shouldSave = Effect.fn("SessionMemory.shouldSave")(function* (ctx: SessionContext) {
      const state = memoryStates.get(ctx.sessionID)
      if (!state?.initialized) {
        // Check if we should initialize based on token count
        const tokenCount = estimateMessageTokens(ctx.messages)
        if (!shouldInitializeMemory(tokenCount)) {
          return false
        }
        return true
      }

      // Check if we should update
      const currentTokenCount = estimateMessageTokens(ctx.messages)
      const currentToolCallCount = countToolCalls(ctx.messages)

      return shouldUpdateMemory(
        currentTokenCount,
        currentToolCallCount,
        state.lastTokenCount,
        state.lastToolCallCount,
      )
    })

    const save = Effect.fn("SessionMemory.save")(function* (ctx: SessionContext, updates: MemoryUpdate) {
      let state = memoryStates.get(ctx.sessionID)

      if (!state?.initialized) {
        const tokenCount = estimateMessageTokens(ctx.messages)
        if (!shouldInitializeMemory(tokenCount)) {
          // Initialize with template if needed
          yield* Effect.promise(() => saveMemory(ctx.sessionID, SESSION_MEMORY_TEMPLATE))
          state = {
            sessionID: ctx.sessionID,
            initialized: true,
            lastTokenCount: 0,
            lastToolCallCount: 0,
            lastUpdated: Date.now(),
            content: SESSION_MEMORY_TEMPLATE,
          }
          memoryStates.set(ctx.sessionID, state)
        }
      }

      const result = yield* update(ctx.sessionID, updates)

      // Update state tracking
      const currentState = memoryStates.get(ctx.sessionID)
      if (currentState) {
        currentState.lastTokenCount = estimateMessageTokens(ctx.messages)
        currentState.lastToolCallCount = countToolCalls(ctx.messages)
        currentState.lastUpdated = Date.now()
        void Effect.promise(() => saveSnapshot(currentState)).pipe(Effect.ignore)
      }

      return result
    })

    const deleteFn = Effect.fn("SessionMemory.delete")(function* (sessionID: SessionID) {
      yield* Effect.promise(() => deleteMemory(sessionID))
      memoryStates.delete(sessionID)
      // Clean up snapshot file
      try {
        const snapshotPath = getSnapshotPath(sessionID)
        void fs.unlink(snapshotPath)
      } catch {}
      log.debug("memory deleted", { sessionID })
    })

    const getContent = Effect.fn("SessionMemory.getContent")(function* (sessionID: SessionID) {
      const content = yield* Effect.promise(() => loadMemory(sessionID))
      return content
    })

    const parseContentFn = (content: string): MemorySections => {
      return parseMemorySections(content)
    }

    return Service.of({
      getState,
      initialize,
      update,
      shouldSave,
      save,
      delete: deleteFn,
      getContent,
      parseContent: parseContentFn,
    })
  }),
)

export const defaultLayer = layer

export * as SessionMemoryService from "./memory-service"
