// Computes prompt loop step budgets and timeouts from already-loaded session state.
// It does not read storage, call providers, or mutate the run loop.
import type { Agent } from "../../agent/agent"
import { isBroadAgentTask } from "../../agent/task-classifier"
import type { MessageV2 } from "../message-v2"

const userText = (message: MessageV2.WithParts | undefined) =>
  message?.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .toLowerCase() ?? ""

export const effectiveMaxSteps = (
  agent: Agent.Info,
  lastUser: MessageV2.User,
  lastUserMsg: MessageV2.WithParts | undefined,
): number => {
  const configured = agent.steps ?? Number.POSITIVE_INFINITY
  const explicit = lastUser.runtime?.stepBudget
  if (explicit) return Math.max(configured, explicit)
  if (!Number.isFinite(configured)) return configured
  const text = [lastUser.system ?? "", userText(lastUserMsg)].join("\n")
  const broad = isBroadAgentTask(text)
  if (agent.name === "explore" && broad) return Math.max(configured, 48)
  if (agent.mode === "subagent" && broad) return Math.max(configured, 36)
  return configured
}

export const promptStepTimeoutMs = (agent: Agent.Info, lastUser: MessageV2.User): number => {
  if (lastUser.runtime?.timeoutMs) return lastUser.runtime.timeoutMs
  if (agent.mode === "subagent") return 10 * 60 * 1000
  if (lastUser.runtime?.effort === "deep") return 20 * 60 * 1000
  if (lastUser.runtime?.effort === "high") return 15 * 60 * 1000
  return 10 * 60 * 1000
}
