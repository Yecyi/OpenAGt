// Applies run-loop reminder text to user messages that arrived after the last finished assistant.
// It does not load reminders, call providers, or persist message changes.
import type { MessageV2 } from "../message-v2"

export const wrapUserMessagesAfterFinish = (
  msgs: MessageV2.WithParts[],
  lastFinished: MessageV2.Assistant | undefined,
): void => {
  if (!lastFinished) return
  for (const msg of msgs) {
    if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
    for (const part of msg.parts) {
      if (part.type !== "text" || part.ignored || part.synthetic) continue
      if (!part.text.trim()) continue
      part.text = [
        "<system-reminder>",
        "The user sent the following message:",
        part.text,
        "",
        "Please address this message and continue with your tasks.",
        "</system-reminder>",
      ].join("\n")
    }
  }
}
