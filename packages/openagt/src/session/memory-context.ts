/**
 * Session Memory Effect Integration
 *
 * Effect Context integration for Session Memory Service.
 * Provides Context.Tag for dependency injection.
 */

import { Context, Effect } from "effect"
import { SessionMemoryService } from "./memory-service"

export const SessionMemory = SessionMemoryService

export * from "./memory-service"
export * from "./memory"
