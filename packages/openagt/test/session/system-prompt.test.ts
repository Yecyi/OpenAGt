import { describe, expect, test, beforeEach } from "bun:test"
import {
  parsePromptSegments,
  isStaticSegment,
  isDynamicSegment,
  getStaticPromptSync,
  invalidateCache,
  getCacheStats,
  clearExpiredCache,
  estimatePromptTokens,
  estimateSavings,
  formatDynamicContext,
  DYNAMIC_BOUNDARY_MARKER,
} from "../../src/session/system-prompt"

describe("parsePromptSegments", () => {
  test("splits content by dynamic boundary marker", () => {
    const content = `Static content here

// SYSTEM_PROMPT_DYNAMIC_BOUNDARY

Dynamic content here`

    const segments = parsePromptSegments(content)

    expect(segments.length).toBeGreaterThanOrEqual(2)
    expect(isStaticSegment(segments[0])).toBe(true)
    expect(isDynamicSegment(segments[segments.length - 1])).toBe(true)
  })

  test("marks entire content as static if no marker", () => {
    const content = "Just static content"

    const segments = parsePromptSegments(content)

    expect(segments.length).toBe(1)
    expect(isStaticSegment(segments[0])).toBe(true)
    expect(isDynamicSegment(segments[0])).toBe(false)
  })

  test("handles empty content", () => {
    const segments = parsePromptSegments("")

    expect(segments.length).toBe(0)
  })
})

describe("isStaticSegment / isDynamicSegment", () => {
  test("correctly identifies static segments", () => {
    const segments = parsePromptSegments(`Static part

// SYSTEM_PROMPT_DYNAMIC_BOUNDARY

Dynamic part`)

    expect(isStaticSegment(segments[0])).toBe(true)
    expect(isDynamicSegment(segments[segments.length - 1])).toBe(true)
  })
})

describe("getStaticPromptSync", () => {
  test("returns default prompt for unknown model", () => {
    const prompt = getStaticPromptSync("unknown-model-xyz")
    expect(prompt.length).toBeGreaterThan(0)
  })

  test("returns prompt for known model", () => {
    const prompt = getStaticPromptSync("anthropic")
    expect(prompt.length).toBeGreaterThan(0)
  })
})

describe("DYNAMIC_BOUNDARY_MARKER", () => {
  test("marker is defined", () => {
    expect(DYNAMIC_BOUNDARY_MARKER).toBe("// SYSTEM_PROMPT_DYNAMIC_BOUNDARY")
  })
})

describe("estimatePromptTokens", () => {
  test("estimates tokens correctly", () => {
    const text = "Hello, world!"
    const tokens = estimatePromptTokens(text)
    expect(tokens).toBe(Math.ceil(text.length / 4))
  })
})

describe("estimateSavings", () => {
  test("calculates savings percentage", () => {
    const savings = estimateSavings(100, 200)
    expect(savings).toBe(50)
  })

  test("handles zero full tokens", () => {
    const savings = estimateSavings(100, 0)
    expect(savings).toBe(0)
  })

  test("handles equal tokens", () => {
    const savings = estimateSavings(100, 100)
    expect(savings).toBe(0)
  })
})

describe("formatDynamicContext", () => {
  test("formats basic context", () => {
    const ctx = {
      sessionID: "test-session",
      workingDirectory: "/tmp",
    }

    const result = formatDynamicContext(ctx)

    expect(result).toContain("Session: test-session")
    expect(result).toContain("Working Directory: /tmp")
  })

  test("formats errors", () => {
    const ctx = {
      recentErrors: ["Error 1", "Error 2"],
    }

    const result = formatDynamicContext(ctx)

    expect(result).toContain("## Recent Errors")
    expect(result).toContain("Error 1")
    expect(result).toContain("Error 2")
  })

  test("formats file changes", () => {
    const ctx = {
      fileChanges: ["file1.ts", "file2.ts"],
    }

    const result = formatDynamicContext(ctx)

    expect(result).toContain("## Recent Changes")
    expect(result).toContain("file1.ts")
  })

  test("formats tool usage", () => {
    const ctx = {
      toolUsage: ["Read", "Write", "Grep"],
    }

    const result = formatDynamicContext(ctx)

    expect(result).toContain("## Tool Usage Summary")
    expect(result).toContain("Read")
  })

  test("handles empty context", () => {
    const result = formatDynamicContext({})
    expect(result).toBe("")
  })
})

describe("cache management", () => {
  beforeEach(() => {
    invalidateCache()
  })

  test("clearExpiredCache removes old entries", () => {
    clearExpiredCache()
    const stats = getCacheStats()
    expect(stats.size).toBe(0)
  })
})
