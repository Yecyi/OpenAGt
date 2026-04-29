// Reads prompt run-loop state from already-loaded messages.
// It does not call providers, mutate session state, or decide fallback behavior.
import type { MessageV2 } from "../message-v2"

export type PromptRunLoopTask = MessageV2.CompactionPart | MessageV2.SubtaskPart

export type PromptRunLoopState = {
  lastUser?: MessageV2.User
  lastAssistant?: MessageV2.Assistant
  lastFinished?: MessageV2.Assistant
  tasks: PromptRunLoopTask[]
}

export const collectRunLoopState = (msgs: MessageV2.WithParts[]): PromptRunLoopState => {
  let lastUser: MessageV2.User | undefined
  let lastAssistant: MessageV2.Assistant | undefined
  let lastFinished: MessageV2.Assistant | undefined
  const tasks: PromptRunLoopTask[] = []

  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (!lastUser && msg.info.role === "user") lastUser = msg.info
    if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info
    if (!lastFinished && msg.info.role === "assistant" && msg.info.finish) lastFinished = msg.info
    if (lastUser && lastFinished) break
    tasks.push(
      ...msg.parts.filter((part): part is PromptRunLoopTask => part.type === "compaction" || part.type === "subtask"),
    )
  }

  return { lastUser, lastAssistant, lastFinished, tasks }
}

export const hasUnhandledToolCalls = (message: MessageV2.WithParts | undefined): boolean =>
  message?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

export const shouldExitRunLoop = (input: {
  lastUser: MessageV2.User
  lastAssistant?: MessageV2.Assistant
  lastAssistantMsg?: MessageV2.WithParts
}): boolean => {
  if (!input.lastAssistant?.finish) return false
  if (["tool-calls"].includes(input.lastAssistant.finish)) return false
  if (hasUnhandledToolCalls(input.lastAssistantMsg)) return false
  return input.lastUser.id < input.lastAssistant.id
}
