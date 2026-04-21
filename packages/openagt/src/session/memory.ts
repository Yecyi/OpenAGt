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

// CC-style trigger thresholds
export const SESSION_MEMORY_TRIGGER = {
  minimumMessageTokensToInit: 6000, // Initialize memory after ~6000 tokens
  minimumTokensBetweenUpdate: 4000, // Update after ~4000 more tokens
  toolCallsBetweenUpdates: 10, // Update after 10 tool calls
} as const

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
export function updateMemorySection(
  content: string,
  section: keyof MemorySections,
  newContent: string,
): string {
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
      const buffer = Buffer.allocate(MAX_MEMORY_CHARS)
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

/**
 * Update memory with incremental changes (only edit specific sections)
 */
export async function updateMemory(
  sessionID: SessionID,
  updates: Partial<Record<keyof MemorySections, string>>,
): Promise<string> {
  const existingContent = await loadMemory(sessionID)
  const content = existingContent ?? SESSION_MEMORY_TEMPLATE

  let updated = content
  for (const [section, newContent] of Object.entries(updates)) {
    if (newContent !== undefined) {
      updated = updateMemorySection(updated, section as keyof MemorySections, newContent)
    }
  }

  await saveMemory(sessionID, updated)
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
 * Check if memory should be initialized based on token count
 */
export function shouldInitializeMemory(tokenCount: number): boolean {
  return tokenCount >= SESSION_MEMORY_TRIGGER.minimumMessageTokensToInit
}

/**
 * Check if memory should be updated based on token/tool call count
 */
export function shouldUpdateMemory(
  currentTokenCount: number,
  currentToolCallCount: number,
  lastTokenCount: number,
  lastToolCallCount: number,
): boolean {
  const tokensSinceUpdate = currentTokenCount - lastTokenCount
  const toolCallsSinceUpdate = currentToolCallCount - lastToolCallCount

  return (
    tokensSinceUpdate >= SESSION_MEMORY_TRIGGER.minimumTokensBetweenUpdate ||
    toolCallsSinceUpdate >= SESSION_MEMORY_TRIGGER.toolCallsBetweenUpdates
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
  return messages.reduce(
    (count, msg) => count + (msg.parts?.filter((p) => p.type === "tool").length ?? 0),
    0,
  )
}

export * as SessionMemory from "./memory"
