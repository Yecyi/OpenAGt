/**
 * Session Memory Module
 *
 * A-P2-1: Session-level MEMORY.md management
 * Persists $XDG_STATE_HOME/opencode/sessions/{id}/memory.md ≤4K tokens
 * and hydrates into semiStatic on session resume.
 */

import path from "path"
import os from "os"
import fs from "fs"
import { SessionID } from "./schema"

const MAX_MEMORY_TOKENS = 4096
const CHARS_PER_TOKEN = 4
const MAX_MEMORY_CHARS = MAX_MEMORY_TOKENS * CHARS_PER_TOKEN

export interface SessionMemory {
  sessionID: SessionID
  content: string
  lastUpdated: number
}

function getMemoryPath(sessionID: SessionID): string {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  return path.join(stateHome, "opencode", "sessions", sessionID, "memory.md")
}

export async function loadMemory(sessionID: SessionID): Promise<string | null> {
  const memoryPath = getMemoryPath(sessionID)
  try {
    const stat = await fs.promises.stat(memoryPath)
    if (stat.size > MAX_MEMORY_CHARS) {
      // Truncate if too large
      const fd = await fs.promises.open(memoryPath, "r")
      const buffer = Buffer.alloc(MAX_MEMORY_CHARS)
      await fd.read(buffer, 0, MAX_MEMORY_CHARS, 0)
      await fd.close()
      return buffer.toString("utf-8")
    }
    return await fs.promises.readFile(memoryPath, "utf-8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    throw error
  }
}

export async function saveMemory(sessionID: SessionID, content: string): Promise<void> {
  const memoryPath = getMemoryPath(sessionID)
  const truncated = content.length > MAX_MEMORY_CHARS ? content.slice(0, MAX_MEMORY_CHARS) : content

  // Ensure directory exists
  await fs.promises.mkdir(path.dirname(memoryPath), { recursive: true })

  await fs.promises.writeFile(memoryPath, truncated, "utf-8")
}

export async function deleteMemory(sessionID: SessionID): Promise<void> {
  const memoryPath = getMemoryPath(sessionID)
  try {
    await fs.promises.unlink(memoryPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }
}

export async function memoryExists(sessionID: SessionID): Promise<boolean> {
  const memoryPath = getMemoryPath(sessionID)
  try {
    await fs.promises.access(memoryPath)
    return true
  } catch {
    return false
  }
}

export * as SessionMemory from "./memory"
