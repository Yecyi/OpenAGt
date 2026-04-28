import { describe, expect, test } from "bun:test"
import { mcpToolOutputParts } from "../../src/session/prompt/mcp-output"

describe("prompt MCP output conversion", () => {
  test("keeps text parts in order and maps images to data-url attachments", () => {
    const result = mcpToolOutputParts([
      { type: "text", text: "first" },
      { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
      { type: "text", text: "second" },
    ])

    expect(result.textParts).toEqual(["first", "second"])
    expect(result.attachments).toEqual([
      {
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ])
  })

  test("maps resource text and blob without assigning message IDs", () => {
    const result = mcpToolOutputParts([
      {
        type: "resource",
        resource: {
          text: "resource text",
          blob: "YmxvYg==",
          uri: "file:///tmp/example.bin",
        },
      },
    ])

    expect(result.textParts).toEqual(["resource text"])
    expect(result.attachments).toEqual([
      {
        type: "file",
        mime: "application/octet-stream",
        url: "data:application/octet-stream;base64,YmxvYg==",
        filename: "file:///tmp/example.bin",
      },
    ])
  })
})
