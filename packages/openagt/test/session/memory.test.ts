import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  SESSION_MEMORY_TEMPLATE,
  getTriggerThresholds,
  parseMemorySections,
  updateMemorySection,
  loadMemory,
  saveMemory,
  updateMemory,
  deleteMemory,
  memoryExists,
  shouldInitializeMemory,
  shouldUpdateMemory,
  estimateMessageTokens,
  countToolCalls,
  type MemorySections,
} from "../../src/session/memory"
import { SessionID } from "../../src/session/schema"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"

/**
 * Session Memory Module Tests
 *
 * Tests for session-level memory management with CC-style nine-section format.
 */

describe("SESSION_MEMORY_TEMPLATE", () => {
  test("template has all required sections", () => {
    expect(SESSION_MEMORY_TEMPLATE).toContain("# Session Title")
    expect(SESSION_MEMORY_TEMPLATE).toContain("# Current State")
    expect(SESSION_MEMORY_TEMPLATE).toContain("# Task specification")
    expect(SESSION_MEMORY_TEMPLATE).toContain("# Files and Functions")
    expect(SESSION_MEMORY_TEMPLATE).toContain("# Workflow")
    expect(SESSION_MEMORY_TEMPLATE).toContain("# Errors & Corrections")
    expect(SESSION_MEMORY_TEMPLATE).toContain("# Learnings")
  })

  test("template has placeholder instructions", () => {
    expect(SESSION_MEMORY_TEMPLATE).toContain("_What is actively being worked on")
    expect(SESSION_MEMORY_TEMPLATE).toContain("_What did the user ask")
    expect(SESSION_MEMORY_TEMPLATE).toContain("_What are the important files")
  })
})

describe("getTriggerThresholds", () => {
  test("has correct default trigger thresholds", () => {
    const thresholds = getTriggerThresholds()
    expect(thresholds.minimumMessageTokensToInit).toBe(6000)
    expect(thresholds.minimumTokensBetweenUpdate).toBe(4000)
    expect(thresholds.toolCallsBetweenUpdates).toBe(10)
  })

  test("overrides with config values", () => {
    const thresholds = getTriggerThresholds({
      trigger: {
        minimumMessageTokensToInit: 3000,
        minimumTokensBetweenUpdate: 2000,
        toolCallsBetweenUpdates: 5,
      },
    })
    expect(thresholds.minimumMessageTokensToInit).toBe(3000)
    expect(thresholds.minimumTokensBetweenUpdate).toBe(2000)
    expect(thresholds.toolCallsBetweenUpdates).toBe(5)
  })

  test("partial config only overrides specified values", () => {
    const thresholds = getTriggerThresholds({
      trigger: {
        minimumMessageTokensToInit: 10000,
      },
    })
    expect(thresholds.minimumMessageTokensToInit).toBe(10000)
    expect(thresholds.minimumTokensBetweenUpdate).toBe(4000)
    expect(thresholds.toolCallsBetweenUpdates).toBe(10)
  })
})

describe("parseMemorySections", () => {
  test("parses empty content", () => {
    const sections = parseMemorySections("")
    expect(sections.title).toBeNull()
    expect(sections.currentState).toBeNull()
  })

  test("parses title section", () => {
    const content = `# Session Title
Test Session Title

# Current State
Working on feature X
`
    const sections = parseMemorySections(content)
    expect(sections.title).toBe("Test Session Title")
  })

  test("parses current state section", () => {
    const content = `# Current State
Implementing authentication
`
    const sections = parseMemorySections(content)
    expect(sections.currentState).toBe("Implementing authentication")
  })

  test("parses all sections", () => {
    const content = `# Session Title
My Session

# Current State
Working on API

# Task specification
Build REST API

# Files and Functions
- src/api.ts
- src/models/

# Workflow
1. npm install
2. npm run build

# Errors & Corrections
Fixed CORS issue

# Learnings
Use middleware for auth
`
    const sections = parseMemorySections(content)
    expect(sections.title).toBe("My Session")
    expect(sections.currentState).toBe("Working on API")
    expect(sections.taskSpec).toBe("Build REST API")
    expect(sections.filesAndFunctions).toContain("src/api.ts")
    expect(sections.workflow).toContain("npm install")
    expect(sections.errorsAndCorrections).toBe("Fixed CORS issue")
    expect(sections.learnings).toBe("Use middleware for auth")
  })

  test("handles missing sections gracefully", () => {
    const content = `# Session Title
Only Title
`
    const sections = parseMemorySections(content)
    expect(sections.title).toBe("Only Title")
    expect(sections.currentState).toBeNull()
    expect(sections.taskSpec).toBeNull()
  })
})

describe("updateMemorySection", () => {
  test("updates existing section", () => {
    const content = `# Session Title
Old Title

# Current State
Old State
`
    const updated = updateMemorySection(content, "title", "New Title")
    expect(updated).toContain("New Title")
    expect(updated).not.toContain("Old Title")
  })

  test("updates currentState section", () => {
    const content = `# Current State
Working on something
`
    const updated = updateMemorySection(content, "currentState", "Finished task")
    expect(updated).toContain("Finished task")
    expect(updated).not.toContain("Working on something")
  })

  test("updates taskSpec section", () => {
    const content = `# Task specification
Build login
`
    const updated = updateMemorySection(content, "taskSpec", "Build logout")
    expect(updated).toContain("Build logout")
  })

  test("adds new section if not found", () => {
    const content = `# Session Title
Test
`
    const updated = updateMemorySection(content, "currentState", "New State")
    expect(updated).toContain("# Current State")
    expect(updated).toContain("New State")
  })

  test("updates filesAndFunctions section", () => {
    const content = `# Files and Functions
- src/index.ts
`
    const updated = updateMemorySection(content, "filesAndFunctions", "- src/main.ts\n- src/config.ts")
    expect(updated).toContain("src/main.ts")
    expect(updated).toContain("src/config.ts")
  })

  test("updates workflow section", () => {
    const content = `# Workflow
1. Step 1
`
    const updated = updateMemorySection(content, "workflow", "1. New Step 1\n2. New Step 2")
    expect(updated).toContain("New Step 1")
    expect(updated).toContain("New Step 2")
  })

  test("updates errorsAndCorrections section", () => {
    const content = `# Errors & Corrections
Error 1: Fixed
`
    const updated = updateMemorySection(content, "errorsAndCorrections", "Error 2: Fixed")
    expect(updated).toContain("Error 2: Fixed")
  })

  test("updates learnings section", () => {
    const content = `# Learnings
Use TypeScript
`
    const updated = updateMemorySection(content, "learnings", "Use Zod for validation")
    expect(updated).toContain("Use Zod for validation")
  })
})

describe("shouldInitializeMemory", () => {
  test("returns false when tokens below threshold", () => {
    expect(shouldInitializeMemory(1000)).toBe(false)
    expect(shouldInitializeMemory(5000)).toBe(false)
  })

  test("returns true when tokens at or above threshold", () => {
    expect(shouldInitializeMemory(6000)).toBe(true)
    expect(shouldInitializeMemory(10000)).toBe(true)
  })

  test("respects custom config threshold", () => {
    expect(shouldInitializeMemory(5000, { trigger: { minimumMessageTokensToInit: 3000 } })).toBe(true)
    expect(shouldInitializeMemory(5000, { trigger: { minimumMessageTokensToInit: 8000 } })).toBe(false)
  })
})

describe("shouldUpdateMemory", () => {
  test("returns true when tokens exceed threshold", () => {
    expect(shouldUpdateMemory(8000, 0, 3000, 0)).toBe(true)
  })

  test("returns true when tool calls exceed threshold", () => {
    expect(shouldUpdateMemory(1000, 15, 500, 0)).toBe(true)
  })

  test("returns false when below both thresholds", () => {
    expect(shouldUpdateMemory(3000, 5, 1000, 0)).toBe(false)
  })

  test("respects custom config thresholds", () => {
    expect(shouldUpdateMemory(2000, 0, 1000, 0, { trigger: { minimumTokensBetweenUpdate: 500 } })).toBe(true)
    expect(shouldUpdateMemory(2000, 3, 1000, 0, { trigger: { toolCallsBetweenUpdates: 2 } })).toBe(true)
  })
})

describe("estimateMessageTokens", () => {
  test("sums input and output tokens", () => {
    const messages = [
      { tokens: { input: 100, output: 50 } },
      { tokens: { input: 200, output: 75 } },
    ]
    expect(estimateMessageTokens(messages)).toBe(425)
  })

  test("handles missing tokens", () => {
    const messages = [
      { tokens: { input: 100 } },
      { tokens: {} },
      {},
    ]
    expect(estimateMessageTokens(messages)).toBe(100)
  })
})

describe("countToolCalls", () => {
  test("counts tool parts in messages", () => {
    const messages = [
      { parts: [{ type: "tool" }, { type: "text" }] },
      { parts: [{ type: "tool" }, { type: "tool" }] },
    ]
    expect(countToolCalls(messages)).toBe(3)
  })

  test("handles missing parts", () => {
    const messages = [
      { parts: [] },
      {},
    ]
    expect(countToolCalls(messages)).toBe(0)
  })
})

describe("loadMemory and saveMemory", () => {
  const testSessionID = "test-session-memory" as SessionID

  afterEach(async () => {
    // Cleanup
    await deleteMemory(testSessionID)
  })

  test("saves and loads memory", async () => {
    const content = `# Session Title
Test Session

# Current State
Working on tests
`
    await saveMemory(testSessionID, content)
    const loaded = await loadMemory(testSessionID)
    expect(loaded).toBe(content)
  })

  test("loadMemory returns null for non-existent memory", async () => {
    const loaded = await loadMemory("non-existent-session" as SessionID)
    expect(loaded).toBeNull()
  })

  test("memoryExists returns correct values", async () => {
    expect(await memoryExists(testSessionID)).toBe(false)
    await saveMemory(testSessionID, "test content")
    expect(await memoryExists(testSessionID)).toBe(true)
  })

  test("deleteMemory removes memory file", async () => {
    await saveMemory(testSessionID, "test content")
    expect(await memoryExists(testSessionID)).toBe(true)
    await deleteMemory(testSessionID)
    expect(await memoryExists(testSessionID)).toBe(false)
  })
})

describe("updateMemory", () => {
  const testSessionID = "test-session-update" as SessionID

  afterEach(async () => {
    await deleteMemory(testSessionID)
  })

  test("creates new memory with template if not exists", async () => {
    const result = await updateMemory(testSessionID, {
      title: "New Session",
    })
    expect(result).toContain("New Session")
    expect(result).toContain("# Session Title")
    expect(result).toContain("# Current State")
    expect(result).toContain("# Task specification")
  })

  test("updates existing memory sections", async () => {
    await saveMemory(testSessionID, SESSION_MEMORY_TEMPLATE)

    const result = await updateMemory(testSessionID, {
      title: "Updated Title",
      currentState: "Updated State",
    })

    expect(result).toContain("Updated Title")
    expect(result).toContain("Updated State")
  })

  test("preserves unchanged sections", async () => {
    await saveMemory(testSessionID, `# Session Title
Original Title

# Learnings
Keep it simple
`)

    const result = await updateMemory(testSessionID, {
      currentState: "New State",
    })

    expect(result).toContain("Original Title")
    expect(result).toContain("Keep it simple")
    expect(result).toContain("New State")
  })
})
