import { describe, expect, test } from "bun:test"
import type { Agent } from "../../src/agent/agent"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { effectiveMaxSteps, promptStepTimeoutMs } from "../../src/session/prompt/step-policy"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const agent = (input: Partial<Agent.Info> = {}): Agent.Info => ({
  name: "general",
  description: "test agent",
  mode: "primary",
  permission: [],
  options: {},
  ...input,
})

const user = (input: Partial<MessageV2.User> = {}): MessageV2.User => ({
  id: MessageID.ascending(),
  sessionID: SessionID.descending(),
  role: "user",
  time: { created: 0 },
  agent: "general",
  model: {
    providerID: ProviderID.openai,
    modelID: ModelID.make("test-model"),
  },
  ...input,
})

const message = (text: string): MessageV2.WithParts => ({
  info: user(),
  parts: [
    {
      id: PartID.ascending(),
      sessionID: SessionID.descending(),
      messageID: MessageID.ascending(),
      type: "text",
      text,
    },
  ],
})

describe("prompt step policy", () => {
  test("honors explicit runtime step budget above configured agent steps", () => {
    expect(effectiveMaxSteps(agent({ steps: 8 }), user({ runtime: { stepBudget: 12 } }), undefined)).toBe(12)
  })

  test("keeps configured steps for narrow primary agent tasks", () => {
    expect(effectiveMaxSteps(agent({ steps: 8 }), user(), message("fix the failing unit test"))).toBe(8)
  })

  test("raises broad explore tasks to the exploration floor", () => {
    expect(
      effectiveMaxSteps(
        agent({ name: "explore", steps: 8 }),
        user({ system: "review the entire repository architecture" }),
        undefined,
      ),
    ).toBe(48)
  })

  test("selects runtime and effort timeouts without loop state", () => {
    expect(promptStepTimeoutMs(agent(), user({ runtime: { timeoutMs: 1_000 } }))).toBe(1_000)
    expect(promptStepTimeoutMs(agent(), user({ runtime: { effort: "deep" } }))).toBe(20 * 60 * 1000)
    expect(promptStepTimeoutMs(agent({ mode: "subagent" }), user({ runtime: { effort: "deep" } }))).toBe(
      10 * 60 * 1000,
    )
  })
})
