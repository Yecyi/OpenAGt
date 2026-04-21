import { describe, expect, test } from "bun:test"
import { detectPathConflicts, extractPathsFromInput } from "../../src/tool/path-overlap"
import { isConcurrencySafe, partitionToolCalls } from "../../src/tool/partition"

describe("tool.partition", () => {
  test("marks read-like tools as concurrency safe", () => {
    expect(isConcurrencySafe("read")).toBe(true)
    expect(isConcurrencySafe("grep")).toBe(true)
    expect(isConcurrencySafe("bash")).toBe(false)
  })

  test("splits unsafe tool calls into isolated batches", () => {
    const batches = partitionToolCalls([
      { toolCallId: "1", toolName: "read", input: { filePath: "src/a.ts" } },
      { toolCallId: "2", toolName: "grep", input: { pattern: "TODO" } },
      { toolCallId: "3", toolName: "bash", input: { command: "echo hi" } },
      { toolCallId: "4", toolName: "read", input: { filePath: "src/b.ts" } },
    ])

    expect(batches).toHaveLength(3)
    expect(batches[0]).toMatchObject({ type: "safe" })
    expect(batches[0]?.tools.map((tool) => tool.toolCallId)).toEqual(["1", "2"])
    expect(batches[1]).toMatchObject({ type: "unsafe" })
    expect(batches[1]?.tools.map((tool) => tool.toolCallId)).toEqual(["3"])
    expect(batches[2]).toMatchObject({ type: "safe" })
    expect(batches[2]?.tools.map((tool) => tool.toolCallId)).toEqual(["4"])
  })
})

describe("tool.path-overlap", () => {
  test("extracts candidate paths from nested tool input", () => {
    const paths = extractPathsFromInput({
      filePath: "src/session/prompt.ts",
      files: ["README.md", "notes.txt"],
      options: { cwd: "packages/opencode" },
      command: "ls -la",
    })

    expect(paths).toContain("src/session/prompt.ts")
    expect(paths).toContain("README.md")
    expect(paths).toContain("packages/opencode")
    expect(paths).not.toContain("ls -la")
  })

  test("detects conflicts for overlapping directories/files", () => {
    const conflicts = detectPathConflicts([
      { toolName: "read", input: { filePath: "src/session/prompt.ts" } },
      { toolName: "edit", input: { filePath: "src/session/compaction.ts" } },
      { toolName: "read", input: { filePath: "docs/plan.md" } },
    ])

    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.some((conflict) => conflict.call1 === 0 && conflict.call2 === 1)).toBe(true)
  })
})
