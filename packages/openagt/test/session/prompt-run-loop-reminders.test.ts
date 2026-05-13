import { expect, test } from "bun:test"
import { wrapUserMessagesAfterFinish } from "../../src/session/prompt/run-loop-reminders"
import type { MessageV2 } from "../../src/session/message-v2"
import type { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { ModelID, ProviderID } from "../../src/provider/schema"

const sessionID = "ses_test" as SessionID
const providerID = "test" as ProviderID
const modelID = "model" as ModelID

const user = (id: string, text: string): MessageV2.WithParts => ({
  info: {
    id: id as MessageID,
    role: "user",
    sessionID,
    time: { created: 1 },
    agent: "build",
    model: { providerID, modelID },
  },
  parts: [
    {
      id: `prt_${id}` as PartID,
      messageID: id as MessageID,
      sessionID,
      type: "text",
      text,
    },
  ],
})

test("wrapUserMessagesAfterFinish wraps only user text after finished assistant", () => {
  const before = user("msg_1", "before")
  const after = user("msg_3", "after")
  wrapUserMessagesAfterFinish([before, after], {
    id: "msg_2" as MessageID,
    parentID: "msg_1" as MessageID,
    role: "assistant",
    sessionID,
    agent: "build",
    mode: "build",
    path: { cwd: ".", root: "." },
    time: { created: 1 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID,
    providerID,
    finish: "stop",
  })

  expect(before.parts[0]?.type === "text" ? before.parts[0].text : "").toBe("before")
  expect(after.parts[0]?.type === "text" ? after.parts[0].text : "").toContain("The user sent the following message:")
})
