/**
 * Session Memory Module
 *
 * A-P2-1: Session-level MEMORY.md management
 * Persists $XDG_STATE_HOME/opencode/sessions/{id}/memory.md ≤4K tokens
 * and hydrates into semiStatic on session resume.
 *
 * Enhanced with CC-style session memory template:
 * - Nine-section format: Title, Current State, Task, Files, Workflow, Errors, Learnings
 * - Trigger conditions for update
 * - Incremental edit updates
 */

import path from "path"
import os from "os"
import fs from "fs"
import { SessionID } from "./schema"

const MAX_MEMORY_TOKENS = 4096
const CHARS_PER_TOKEN = 4
const MAX_MEMORY_CHARS = MAX_MEMORY_TOKENS * CHARS_PER_TOKEN

/**
 * Memory configuration from opencode.json
 */
export interface MemoryConfig {
  template?: string
  maxTokens?: number
  trigger?: {
    minimumMessageTokensToInit?: number
    minimumTokensBetweenUpdate?: number
    toolCallsBetweenUpdates?: number
  }
}

/**
 * Runtime trigger thresholds — defaults with optional overrides from config
 */
export function getTriggerThresholds(config?: MemoryConfig) {
  return {
    minimumMessageTokensToInit: config?.trigger?.minimumMessageTokensToInit ?? 6000,
    minimumTokensBetweenUpdate: config?.trigger?.minimumTokensBetweenUpdate ?? 4000,
    toolCallsBetweenUpdates: config?.trigger?.toolCallsBetweenUpdates ?? 10,
  }
}

export interface SessionMemory {
  sessionID: SessionID
  content: string
  lastUpdated: number
  version: number
  lastTokenCount: number
  lastToolCallCount: number
}

/**
 * CC-style Session Memory Template (Nine-section format)
 */
export const SESSION_MEMORY_TEMPLATE = `# Session Title
_A short and distinctive 5-10 word descriptive title_

# Current State
_What is actively being worked on right now?_

# Task specification
_What did the user ask to build?_

# Files and Functions
_What are the important files? What do they contain?_

# Workflow
_What bash commands are usually run and in what order?_

# Errors & Corrections
_Errors encountered and how they were fixed_

# Learnings
_What has worked well? What to avoid?_
` as const

/**
 * Parse existing memory content into sections
 */
export interface MemorySections {
  title: string | null
  currentState: string | null
  taskSpec: string | null
  filesAndFunctions: string | null
  workflow: string | null
  errorsAndCorrections: string | null
  learnings: string | null
}

export function parseMemorySections(content: string): MemorySections {
  const sections: MemorySections = {
    title: null,
    currentState: null,
    taskSpec: null,
    filesAndFunctions: null,
    workflow: null,
    errorsAndCorrections: null,
    learnings: null,
  }

  const patterns: Array<{ key: keyof MemorySections; regex: RegExp }> = [
    { key: "title", regex: /^#\s*Session\s*Title\s*\n([\s\S]*?)(?=\n#|\n*$)/im },
    { key: "currentState", regex: /^#\s*Current\s*State\s*\n([\s\S]*?)(?=\n#|\n*$)/im },
    { key: "taskSpec", regex: /^#\s*Task\s*specification\s*\n([\s\S]*?)(?=\n#|\n*$)/im },
    { key: "filesAndFunctions", regex: /^#\s*Files\s*and\s*Functions\s*\n([\s\S]*?)(?=\n#|\n*$)/im },
    { key: "workflow", regex: /^#\s*Workflow\s*\n([\s\S]*?)(?=\n#|\n*$)/im },
    { key: "errorsAndCorrections", regex: /^#\s*Errors?\s*&\s*Corrections\s*\n([\s\S]*?)(?=\n#|\n*$)/im },
    { key: "learnings", regex: /^#\s*Learnings\s*\n([\s\S]*?)(?=\n#|\n*$)/im },
  ]

  for (const { key, regex } of patterns) {
    const match = content.match(regex)
    if (match && match[1]) {
      sections[key] = match[1].trim()
    }
  }

  return sections
}

/**
 * Update a specific section in memory content (incremental edit)
 */
export function updateMemorySection(content: string, section: keyof MemorySections, newContent: string): string {
  const sectionPatterns: Record<keyof MemorySections, string> = {
    title: "# Session Title",
    currentState: "# Current State",
    taskSpec: "# Task specification",
    filesAndFunctions: "# Files and Functions",
    workflow: "# Workflow",
    errorsAndCorrections: "# Errors & Corrections",
    learnings: "# Learnings",
  }

  const sectionHeader = sectionPatterns[section]
  const lines = content.split("\n")
  const result: string[] = []
  let inSection = false
  let foundSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const nextLine = lines[i + 1]

    if (line.startsWith(sectionHeader)) {
      inSection = true
      foundSection = true
      result.push(line)
      // Add placeholder if next line doesn't start with a header or content
      if (!nextLine || (!nextLine.startsWith("#") && !nextLine.startsWith("_"))) {
        result.push(newContent)
      } else if (nextLine.startsWith("_")) {
        // Skip placeholder line
        i++
        result.push(newContent)
      }
    } else if (inSection && line.startsWith("# ")) {
      // Entered next section
      inSection = false
      result.push(line)
    } else if (inSection && !line.startsWith("_")) {
      // Content line in section, skip (replace with new content)
      continue
    } else {
      result.push(line)
    }
  }

  // If section doesn't exist, append it
  if (!foundSection) {
    result.push("")
    result.push(sectionHeader)
    result.push(newContent)
  }

  return result.join("\n")
}

function getMaxMemoryChars(config?: MemoryConfig): number {
  const maxTokens = config?.maxTokens ?? MAX_MEMORY_TOKENS
  return maxTokens * CHARS_PER_TOKEN
}

function getMemoryPath(sessionID: SessionID): string {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  return path.join(stateHome, "opencode", "sessions", sessionID, "memory.md")
}

export async function loadMemory(sessionID: SessionID, config?: MemoryConfig): Promise<string | null> {
  const memoryPath = getMemoryPath(sessionID)
  const maxChars = getMaxMemoryChars(config)
  try {
    const stat = await fs.promises.stat(memoryPath)
    if (stat.size > maxChars) {
      const fd = await fs.promises.open(memoryPath, "r")
      const buffer = Buffer.alloc(maxChars)
      await fd.read(buffer, 0, maxChars, 0)
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

export async function saveMemory(sessionID: SessionID, content: string, config?: MemoryConfig): Promise<void> {
  const memoryPath = getMemoryPath(sessionID)
  const maxChars = getMaxMemoryChars(config)
  const truncated = content.length > maxChars ? content.slice(0, maxChars) : content

  await fs.promises.mkdir(path.dirname(memoryPath), { recursive: true })

  await fs.promises.writeFile(memoryPath, truncated, "utf-8")
}

/**
 * Update memory with incremental changes (only edit specific sections)
 */
export async function updateMemory(
  sessionID: SessionID,
  updates: Partial<Record<keyof MemorySections, string>>,
  config?: MemoryConfig,
): Promise<string> {
  const existingContent = await loadMemory(sessionID, config)
  const content = existingContent ?? SESSION_MEMORY_TEMPLATE

  let updated = content
  for (const [section, newContent] of Object.entries(updates)) {
    if (newContent !== undefined) {
      updated = updateMemorySection(updated, section as keyof MemorySections, newContent)
    }
  }

  await saveMemory(sessionID, updated, config)
  return updated
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

/**
 * Determine which memory action to take given current session state.
 * Returns "init" if memory hasn't been created yet and threshold is met.
 * Returns "update" if memory exists and should be refreshed.
 * Returns null if no action is warranted.
 */
export function shouldTriggerMemory(
  currentTokenCount: number,
  currentToolCallCount: number,
  memoryExists: boolean,
  lastTokenCount: number = 0,
  lastToolCallCount: number = 0,
  config?: MemoryConfig,
): "init" | "update" | null {
  const thresholds = getTriggerThresholds(config)
  if (!memoryExists) {
    if (currentTokenCount >= thresholds.minimumMessageTokensToInit) return "init"
    return null
  }
  const tokensSinceUpdate = currentTokenCount - lastTokenCount
  const toolCallsSinceUpdate = currentToolCallCount - lastToolCallCount
  if (
    tokensSinceUpdate >= thresholds.minimumTokensBetweenUpdate ||
    toolCallsSinceUpdate >= thresholds.toolCallsBetweenUpdates
  ) {
    return "update"
  }
  return null
}

export function shouldInitializeMemory(tokenCount: number, config?: MemoryConfig): boolean {
  return tokenCount >= getTriggerThresholds(config).minimumMessageTokensToInit
}

export function shouldUpdateMemory(
  currentTokenCount: number,
  currentToolCallCount: number,
  lastTokenCount: number,
  lastToolCallCount: number,
  config?: MemoryConfig,
): boolean {
  const thresholds = getTriggerThresholds(config)
  const tokensSinceUpdate = currentTokenCount - lastTokenCount
  const toolCallsSinceUpdate = currentToolCallCount - lastToolCallCount
  return (
    tokensSinceUpdate >= thresholds.minimumTokensBetweenUpdate ||
    toolCallsSinceUpdate >= thresholds.toolCallsBetweenUpdates
  )
}

/**
 * Estimate token count for messages
 */
export function estimateMessageTokens(messages: Array<{ tokens?: { input?: number; output?: number } }>): number {
  return messages.reduce((sum, msg) => sum + (msg.tokens?.input ?? 0) + (msg.tokens?.output ?? 0), 0)
}

/**
 * Count tool calls in messages
 */
export function countToolCalls(messages: Array<{ parts?: Array<{ type?: string }> }>): number {
  return messages.reduce((count, msg) => count + (msg.parts?.filter((p) => p.type === "tool").length ?? 0), 0)
}

export * as SessionMemory from "./memory"
