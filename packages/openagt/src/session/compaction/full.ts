import { Effect } from "effect"
import { MessageV2 } from "../message-v2"
import { Log, Token } from "@/util"

const log = Log.create({ service: "compaction.full" })

// Constants from Claude Code reference
export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5
export const POST_COMPACT_TOKEN_BUDGET = 50_000
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000
export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000
export const MAX_COMPACT_STREAMING_RETRIES = 2

export interface FullCompactConfig {
  summaryTemplate: string
  maxReinjectFiles: number
  maxReinjectTokens: number
  iterativeUpdate: boolean
  deduplicateSummaries: boolean
  // Additional config from Claude Code reference
  maxFilesToRestore?: number
  tokenBudget?: number
  maxTokensPerFile?: number
  maxTokensPerSkill?: number
  skillsTokenBudget?: number
}

export const DEFAULT_FULL_COMPACT_CONFIG: FullCompactConfig = {
  summaryTemplate: `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: follow the summary template below.

Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.
Respond in the same language as the user's messages in the conversation.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`,
  maxReinjectFiles: 5,
  maxReinjectTokens: 25_000,
  iterativeUpdate: true,
  deduplicateSummaries: true,
  maxFilesToRestore: POST_COMPACT_MAX_FILES_TO_RESTORE,
  tokenBudget: POST_COMPACT_TOKEN_BUDGET,
  maxTokensPerFile: POST_COMPACT_MAX_TOKENS_PER_FILE,
  maxTokensPerSkill: POST_COMPACT_MAX_TOKENS_PER_SKILL,
  skillsTokenBudget: POST_COMPACT_SKILLS_TOKEN_BUDGET,
}

/**
 * Strip image blocks from user messages before sending for compaction.
 * Images are not needed for generating a conversation summary and can
 * cause the compaction API call itself to hit the prompt-too-long limit.
 * Replaces image blocks with a text marker so the summary still notes
 * that an image was shared.
 */
export function stripImagesFromMessages(messages: MessageV2.WithParts[]): MessageV2.WithParts[] {
  return messages.map(message => {
    if (message.info.role !== "user") {
      return message
    }

    let hasMediaBlock = false

    const updatedParts = message.parts.map(part => {
      // Handle text parts - check for inline images
      if (part.type === "text") {
        // Text parts don't typically contain image blocks in our model
        return part
      }

      // Handle file/attachment parts
      if (part.type === "file") {
        const mime = part.mime
        // Check if it's an image or document
        if (mime.startsWith("image/") || mime.startsWith("application/pdf") || mime.startsWith("document/")) {
          hasMediaBlock = true
          return {
            ...part,
            // Replace with text marker
            type: "text" as const,
            text: mime.startsWith("image/") ? "[image]" : "[document]",
            mime: undefined,
            filename: part.filename,
          }
        }
        return part
      }

      // Handle tool parts - check for media in tool results
      if (part.type === "tool" && part.state.status === "completed" && "output" in part.state) {
        // Check if output contains media indicators
        // This is a simplified version - full implementation would parse structured output
        return part
      }

      return part
    })

    if (!hasMediaBlock) {
      return message
    }

    return { ...message, parts: updatedParts }
  })
}

export interface ExistingSummary {
  content: string
  messageID: string
  timestamp: number
  version: number
}

export function findExistingSummary(messages: MessageV2.WithParts[]): ExistingSummary | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue
    const assistantInfo = msg.info as MessageV2.Assistant
    if (!assistantInfo.summary) continue

    for (const part of msg.parts) {
      if (part.type === "text" && part.text.length > 100) {
        return {
          content: part.text,
          messageID: msg.info.id,
          timestamp: msg.info.time.created,
          version: 1,
        }
      }
    }
  }
  return undefined
}

export function extractKeyFiles(
  messages: MessageV2.WithParts[],
  config: FullCompactConfig = DEFAULT_FULL_COMPACT_CONFIG,
): Array<{ path: string; content: string; tokens: number }> {
  const files: Map<string, { content: string; tokens: number; timestamp: number }> = new Map()

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      if (part.tool !== "read") continue
      if (part.state.status !== "completed") continue

      const args = part.state.input as { path?: string } | undefined
      const path = args?.path
      if (!path) continue

      const existing = files.get(path)
      const tokens = Token.estimate(part.state.output)
      const timestamp = part.state.time.end ?? part.state.time.start

      if (!existing || timestamp > existing.timestamp) {
        files.set(path, { content: part.state.output, tokens, timestamp })
      }
    }
  }

  const sorted = Array.from(files.entries())
    .sort((a, b) => b[1].timestamp - a[1].timestamp)
    .slice(0, config.maxReinjectFiles)

  const result: Array<{ path: string; content: string; tokens: number }> = []
  let totalTokens = 0

  for (const [path, { content, tokens }] of sorted) {
    if (totalTokens + tokens > config.maxReinjectTokens) continue
    result.push({ path, content, tokens })
    totalTokens += tokens
  }

  return result
}

export interface CompactContext {
  existingSummary?: ExistingSummary
  keyFiles: Array<{ path: string; content: string; tokens: number }>
  recentTools: Array<{ tool: string; input: string; output: string; timestamp: number }>
  userGoals: string[]
  pendingTasks: string[]
}

export function buildCompactContext(
  messages: MessageV2.WithParts[],
  config: FullCompactConfig = DEFAULT_FULL_COMPACT_CONFIG,
): CompactContext {
  const existingSummary = config.iterativeUpdate ? findExistingSummary(messages) : undefined
  const keyFiles = extractKeyFiles(messages, config)

  const recentTools: CompactContext["recentTools"] = []
  const userGoals: string[] = []
  const pendingTasks: string[] = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]

    if (msg.info.role === "user") {
      const textParts = msg.parts.filter((p) => p.type === "text")
      if (textParts.length > 0) {
        const text = textParts.map((p) => (p as MessageV2.TextPart).text).join("\n")
        if (text.length < 500) {
          userGoals.unshift(text)
        }
      }
    }

    if (msg.info.role === "assistant") {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.state.status !== "completed") continue

        const args = part.state.input as Record<string, unknown>
        const inputStr = JSON.stringify(args).slice(0, 200)
        const outputStr = part.state.output.slice(0, 500)

        recentTools.push({
          tool: part.tool,
          input: inputStr,
          output: outputStr,
          timestamp: part.state.time.end ?? part.state.time.start,
        })

        if (part.tool === "todo" && args.tasks) {
          const tasks = args.tasks as Array<{ content?: string; status?: string }>
          for (const task of tasks) {
            if (task.status !== "completed") {
              pendingTasks.push(task.content ?? "")
            }
          }
        }
      }
    }

    if (recentTools.length >= 10) break
  }

  return {
    existingSummary,
    keyFiles,
    recentTools,
    userGoals: userGoals.slice(0, 3),
    pendingTasks: pendingTasks.slice(0, 5),
  }
}

export function formatCompactPrompt(
  context: CompactContext,
  config: FullCompactConfig = DEFAULT_FULL_COMPACT_CONFIG,
): string {
  const parts: string[] = []

  if (context.existingSummary) {
    parts.push(`EXISTING SUMMARY (update this, do not replace):\n${context.existingSummary.content}\n`)
  }

  if (context.userGoals.length > 0) {
    parts.push(`USER GOALS:\n${context.userGoals.map((g) => `- ${g}`).join("\n")}\n`)
  }

  if (context.keyFiles.length > 0) {
    parts.push(
      `RECENTLY READ FILES:\n${context.keyFiles.map((f) => `## ${f.path}\n\`\`\`\n${f.content.slice(0, 2000)}\n\`\`\``).join("\n\n")}\n`,
    )
  }

  if (context.recentTools.length > 0) {
    parts.push(
      `RECENT TOOL CALLS:\n${context.recentTools.map((t) => `- ${t.tool}: ${t.input}`).join("\n")}\n`,
    )
  }

  if (context.pendingTasks.length > 0) {
    parts.push(`PENDING TASKS:\n${context.pendingTasks.map((t) => `- ${t}`).join("\n")}\n`)
  }

  parts.push(`\n${config.summaryTemplate}`)

  return parts.join("\n")
}
