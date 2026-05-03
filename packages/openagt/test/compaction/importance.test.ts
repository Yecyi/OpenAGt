import { test, expect } from "bun:test"
import {
  calculateToolImportance,
  getContentPreservationWeight,
  shouldPreserveByContent,
  TOOL_IMPORTANCE_WEIGHT,
} from "../../src/session/compaction/importance"

test("escalate_to_inbox is treated as critical (weight 10)", () => {
  expect(calculateToolImportance("escalate_to_inbox")).toBe(10)
  expect(TOOL_IMPORTANCE_WEIGHT["escalate_to_inbox"]).toBe(10)
})

test("task_give_up is treated as critical (weight 10)", () => {
  expect(calculateToolImportance("task_give_up")).toBe(10)
})

test("task delegation gets high importance (weight 8)", () => {
  expect(calculateToolImportance("task")).toBe(8)
})

test("todowrite (actual tool name) gets weight 7", () => {
  expect(calculateToolImportance("todowrite")).toBe(7)
})

test("unknown tool falls back to weight 1", () => {
  expect(calculateToolImportance("nonexistent_tool")).toBe(1)
})

test("architectural decision content is preserved (weight >= 8)", () => {
  expect(getContentPreservationWeight("Decided to use PostgreSQL instead of MongoDB")).toBeGreaterThanOrEqual(8)
  expect(getContentPreservationWeight("Migrated to Effect-TS for the runtime")).toBeGreaterThanOrEqual(8)
  expect(getContentPreservationWeight("Switched to bun from node")).toBeGreaterThanOrEqual(8)
  expect(shouldPreserveByContent("Decided to migrate to a new architecture")).toBe(true)
})

test("architectural rejection content is preserved (weight >= 8)", () => {
  expect(getContentPreservationWeight("Rejected the SQLite approach due to write contention")).toBeGreaterThanOrEqual(8)
  expect(getContentPreservationWeight("Reverted the change after benchmarks regressed")).toBeGreaterThanOrEqual(8)
})

test("plain operational output is not over-preserved", () => {
  expect(getContentPreservationWeight("Listed 3 files in /tmp")).toBe(0)
})
