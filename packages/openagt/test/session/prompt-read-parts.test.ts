import { describe, expect, test } from "bun:test"
import { readToolCallPart, readToolFailurePart, syntheticTextPart } from "../../src/session/prompt/read-parts"
import { MessageID, SessionID } from "../../src/session/schema"

const scope = {
  messageID: MessageID.ascending(),
  sessionID: SessionID.descending(),
}

describe("prompt read parts", () => {
  test("builds synthetic text parts without assigning part IDs", () => {
    expect(syntheticTextPart(scope, "content")).toEqual({
      messageID: scope.messageID,
      sessionID: scope.sessionID,
      type: "text",
      synthetic: true,
      text: "content",
    })
  })

  test("preserves Read tool call JSON formatting", () => {
    expect(readToolCallPart(scope, { filePath: "/tmp/a.txt", offset: 2, limit: undefined }).text).toBe(
      'Called the Read tool with the following input: {"filePath":"/tmp/a.txt","offset":2}',
    )
  })

  test("preserves Read tool failure wording", () => {
    expect(readToolFailurePart(scope, "/tmp/a.txt", "missing").text).toBe(
      "Read tool failed to read /tmp/a.txt with the following error: missing",
    )
  })
})
