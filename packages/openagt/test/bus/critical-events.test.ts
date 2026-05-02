import { describe, expect, test } from "bun:test"
import { CRITICAL_EVENT_TYPES, isCriticalEventType } from "../../src/bus"
import { ToolsChanged } from "../../src/mcp/events"

// Regression for April 2026-04 finding 4.3 — bus persistence whitelist drift.
//
// The whitelist in bus/index.ts had `"tools.changed"` but the only emitter
// (mcp/client-state.ts via mcp/events.ts) defines the BusEvent as
// `"mcp.tools.changed"`. The lookup never matched, so MCP tools-changed
// events were silently absent from the persisted ring buffer. This test
// pins the exact emitted name, so a future rename of either side fails CI
// instead of silently dropping events again.
describe("bus critical-event whitelist", () => {
  test("ToolsChanged BusEvent type is in the persistence whitelist", () => {
    expect(CRITICAL_EVENT_TYPES).toContain(ToolsChanged.type)
    expect(isCriticalEventType(ToolsChanged.type)).toBe(true)
  })

  test("isCriticalEventType returns false for unknown event types", () => {
    expect(isCriticalEventType("nonexistent.event")).toBe(false)
    // Wave 6 behavior.* events are gated by OPENAGT_BEHAVIOR_AUDIT and not in
    // CRITICAL_EVENT_TYPES; verify they aren't included in the unconditional
    // critical set so the env-var gate continues to mean something.
    expect(CRITICAL_EVENT_TYPES).not.toContain("behavior.tool.invoked")
  })
})
