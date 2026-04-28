import { describe, expect, test } from "bun:test"
import {
  mcpResourceBinaryPart,
  mcpResourceFailurePart,
  mcpResourceReadPart,
} from "../../src/session/prompt/mcp-resource-parts"
import { MessageID, SessionID } from "../../src/session/schema"

const scope = {
  messageID: MessageID.ascending(),
  sessionID: SessionID.descending(),
}

describe("prompt MCP resource parts", () => {
  test("preserves resource read intro wording", () => {
    expect(mcpResourceReadPart(scope, "doc.txt", "file:///doc.txt").text).toBe(
      "Reading MCP resource: doc.txt (file:///doc.txt)",
    )
  })

  test("preserves binary and failure wording", () => {
    expect(mcpResourceBinaryPart(scope, "application/pdf").text).toBe("[Binary content: application/pdf]")
    expect(mcpResourceBinaryPart(scope, undefined).text).toBe("[Binary content: undefined]")
    expect(mcpResourceFailurePart(scope, "doc.txt", "missing").text).toBe(
      "Failed to read MCP resource doc.txt: missing",
    )
  })
})
