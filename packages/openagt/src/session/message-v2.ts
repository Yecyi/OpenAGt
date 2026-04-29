import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID, PartID } from "./schema"
import z from "zod"
import { NamedError } from "@openagt/shared/util/error"
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"
import {
  AbortedError,
  APIError,
  AuthError,
  ContextOverflowError,
  OutputLengthError,
  StructuredOutputError,
} from "./message-errors"
export {
  AbortedError,
  APIError,
  AuthError,
  ContextOverflowError,
  OutputLengthError,
  StructuredOutputError,
} from "./message-errors"
import { LSP } from "../lsp"
import { Snapshot } from "@/snapshot"
import { SyncEvent } from "../sync"
import { isMedia } from "@/util/media"
import type { Provider } from "@/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect } from "effect"
import { EffectLogger } from "@/effect"
import {
  convertAssistantMessage,
  convertUserMessage,
  supportsMediaInToolResults,
  synthesizeMediaMessage,
  toModelOutput,
} from "./to-model-messages"

export const SYNTHETIC_ATTACHMENT_PROMPT = "Attached image(s) from tool result:"
export { isMedia }

export const OutputFormatText = z
  .object({
    type: z.literal("text"),
  })
  .meta({
    ref: "OutputFormatText",
  })

export const OutputFormatJsonSchema = z
  .object({
    type: z.literal("json_schema"),
    schema: z.record(z.string(), z.any()).meta({ ref: "JSONSchema" }),
    retryCount: z.number().int().min(0).default(2),
  })
  .meta({
    ref: "OutputFormatJsonSchema",
  })

export const Format = z.discriminatedUnion("type", [OutputFormatText, OutputFormatJsonSchema]).meta({
  ref: "OutputFormat",
})
export type OutputFormat = z.infer<typeof Format>

export const Runtime = z
  .object({
    stepBudget: z.number().int().positive().max(240).optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxParallelSubagents: z.number().int().positive().optional(),
    effort: z.enum(["low", "medium", "high", "deep"]).optional(),
    workflow: z.string().optional(),
    taskKind: z.string().optional(),
    reason: z.string().optional(),
  })
  .meta({
    ref: "MessageRuntime",
  })
export type Runtime = z.infer<typeof Runtime>

const PartBase = z.object({
  id: PartID.zod,
  sessionID: SessionID.zod,
  messageID: MessageID.zod,
})

export const SnapshotPart = PartBase.extend({
  type: z.literal("snapshot"),
  snapshot: z.string(),
}).meta({
  ref: "SnapshotPart",
})
export type SnapshotPart = z.infer<typeof SnapshotPart>

export const PatchPart = PartBase.extend({
  type: z.literal("patch"),
  hash: z.string(),
  files: z.string().array(),
}).meta({
  ref: "PatchPart",
})
export type PatchPart = z.infer<typeof PatchPart>

export const TextPart = PartBase.extend({
  type: z.literal("text"),
  text: z.string(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
  time: z
    .object({
      start: z.number(),
      end: z.number().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.any()).optional(),
}).meta({
  ref: "TextPart",
})
export type TextPart = z.infer<typeof TextPart>

export const ReasoningPart = PartBase.extend({
  type: z.literal("reasoning"),
  text: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  time: z.object({
    start: z.number(),
    end: z.number().optional(),
  }),
}).meta({
  ref: "ReasoningPart",
})
export type ReasoningPart = z.infer<typeof ReasoningPart>

const FilePartSourceBase = z.object({
  text: z
    .object({
      value: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    })
    .meta({
      ref: "FilePartSourceText",
    }),
})

export const FileSource = FilePartSourceBase.extend({
  type: z.literal("file"),
  path: z.string(),
}).meta({
  ref: "FileSource",
})

export const SymbolSource = FilePartSourceBase.extend({
  type: z.literal("symbol"),
  path: z.string(),
  range: LSP.Range,
  name: z.string(),
  kind: z.number().int(),
}).meta({
  ref: "SymbolSource",
})

export const ResourceSource = FilePartSourceBase.extend({
  type: z.literal("resource"),
  clientName: z.string(),
  uri: z.string(),
}).meta({
  ref: "ResourceSource",
})

export const FilePartSource = z.discriminatedUnion("type", [FileSource, SymbolSource, ResourceSource]).meta({
  ref: "FilePartSource",
})

export const FilePart = PartBase.extend({
  type: z.literal("file"),
  mime: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  source: FilePartSource.optional(),
}).meta({
  ref: "FilePart",
})
export type FilePart = z.infer<typeof FilePart>

export const AgentPart = PartBase.extend({
  type: z.literal("agent"),
  name: z.string(),
  source: z
    .object({
      value: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    })
    .optional(),
}).meta({
  ref: "AgentPart",
})
export type AgentPart = z.infer<typeof AgentPart>

export const CompactionPart = PartBase.extend({
  type: z.literal("compaction"),
  auto: z.boolean(),
  overflow: z.boolean().optional(),
}).meta({
  ref: "CompactionPart",
})
export type CompactionPart = z.infer<typeof CompactionPart>

export const SubtaskPart = PartBase.extend({
  type: z.literal("subtask"),
  prompt: z.string(),
  description: z.string(),
  agent: z.string(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  command: z.string().optional(),
}).meta({
  ref: "SubtaskPart",
})
export type SubtaskPart = z.infer<typeof SubtaskPart>

export const RetryPart = PartBase.extend({
  type: z.literal("retry"),
  attempt: z.number(),
  error: APIError.Schema,
  time: z.object({
    created: z.number(),
  }),
}).meta({
  ref: "RetryPart",
})
export type RetryPart = z.infer<typeof RetryPart>

export const StepStartPart = PartBase.extend({
  type: z.literal("step-start"),
  snapshot: z.string().optional(),
}).meta({
  ref: "StepStartPart",
})
export type StepStartPart = z.infer<typeof StepStartPart>

export const StepFinishPart = PartBase.extend({
  type: z.literal("step-finish"),
  reason: z.string(),
  snapshot: z.string().optional(),
  cost: z.number(),
  tokens: z.object({
    total: z.number().optional(),
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }),
  }),
}).meta({
  ref: "StepFinishPart",
})
export type StepFinishPart = z.infer<typeof StepFinishPart>

export const ToolStatePending = z
  .object({
    status: z.literal("pending"),
    input: z.record(z.string(), z.any()),
    raw: z.string(),
  })
  .meta({
    ref: "ToolStatePending",
  })

export type ToolStatePending = z.infer<typeof ToolStatePending>

export const ToolStateRunning = z
  .object({
    status: z.literal("running"),
    input: z.record(z.string(), z.any()),
    title: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
    }),
  })
  .meta({
    ref: "ToolStateRunning",
  })
export type ToolStateRunning = z.infer<typeof ToolStateRunning>

export const ToolStateCompleted = z
  .object({
    status: z.literal("completed"),
    input: z.record(z.string(), z.any()),
    output: z.string(),
    title: z.string(),
    metadata: z.record(z.string(), z.any()),
    time: z.object({
      start: z.number(),
      end: z.number(),
      compacted: z.number().optional(),
    }),
    attachments: FilePart.array().optional(),
  })
  .meta({
    ref: "ToolStateCompleted",
  })
export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>

export const ToolStateError = z
  .object({
    status: z.literal("error"),
    input: z.record(z.string(), z.any()),
    error: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number(),
    }),
  })
  .meta({
    ref: "ToolStateError",
  })
export type ToolStateError = z.infer<typeof ToolStateError>

export const ToolState = z
  .discriminatedUnion("status", [ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])
  .meta({
    ref: "ToolState",
  })

export const ToolPart = PartBase.extend({
  type: z.literal("tool"),
  callID: z.string(),
  tool: z.string(),
  state: ToolState,
  metadata: z.record(z.string(), z.any()).optional(),
}).meta({
  ref: "ToolPart",
})
export type ToolPart = z.infer<typeof ToolPart>

const Base = z.object({
  id: MessageID.zod,
  sessionID: SessionID.zod,
})

export const User = Base.extend({
  role: z.literal("user"),
  time: z.object({
    created: z.number(),
  }),
  format: Format.optional(),
  summary: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      diffs: Snapshot.FileDiff.array(),
    })
    .optional(),
  agent: z.string(),
  model: z.object({
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
    variant: z.string().optional(),
  }),
  system: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  runtime: Runtime.optional(),
}).meta({
  ref: "UserMessage",
})
export type User = z.infer<typeof User>

export const Part = z
  .discriminatedUnion("type", [
    TextPart,
    SubtaskPart,
    ReasoningPart,
    FilePart,
    ToolPart,
    StepStartPart,
    StepFinishPart,
    SnapshotPart,
    PatchPart,
    AgentPart,
    RetryPart,
    CompactionPart,
  ])
  .meta({
    ref: "Part",
  })
export type Part = z.infer<typeof Part>

export const Assistant = Base.extend({
  role: z.literal("assistant"),
  time: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
  error: z
    .discriminatedUnion("name", [
      AuthError.Schema,
      NamedError.Unknown.Schema,
      OutputLengthError.Schema,
      AbortedError.Schema,
      StructuredOutputError.Schema,
      ContextOverflowError.Schema,
      APIError.Schema,
    ])
    .optional(),
  parentID: MessageID.zod,
  modelID: ModelID.zod,
  providerID: ProviderID.zod,
  /**
   * @deprecated
   */
  mode: z.string(),
  agent: z.string(),
  path: z.object({
    cwd: z.string(),
    root: z.string(),
  }),
  summary: z.boolean().optional(),
  cost: z.number(),
  tokens: z.object({
    total: z.number().optional(),
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }),
  }),
  structured: z.any().optional(),
  variant: z.string().optional(),
  finish: z.string().optional(),
}).meta({
  ref: "AssistantMessage",
})
export type Assistant = z.infer<typeof Assistant>

export const Info = z.discriminatedUnion("role", [User, Assistant]).meta({
  ref: "Message",
})
export type Info = z.infer<typeof Info>

export const Event = {
  Updated: SyncEvent.define({
    type: "message.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      info: Info,
    }),
  }),
  Removed: SyncEvent.define({
    type: "message.removed",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
  }),
  PartUpdated: SyncEvent.define({
    type: "message.part.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      part: Part,
      time: z.number(),
    }),
  }),
  PartDelta: BusEvent.define(
    "message.part.delta",
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string(),
    }),
  ),
  PartRemoved: SyncEvent.define({
    type: "message.part.removed",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
    }),
  }),
}

export const WithParts = z.object({
  info: Info,
  parts: z.array(Part),
})
export type WithParts = z.infer<typeof WithParts>

export const toModelMessagesEffect = Effect.fnUntraced(function* (
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean },
) {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  const supportsMedia = supportsMediaInToolResults(model)

  for (const msg of input) {
    if (msg.parts.length === 0) continue

    if (msg.info.role === "user") {
      const userMessage = convertUserMessage(msg, options)
      if (userMessage) result.push(userMessage)
    }

    if (msg.info.role === "assistant") {
      const converted = convertAssistantMessage(msg, model, supportsMedia, options)
      if (converted) {
        result.push(converted.uiMessage)
        for (const t of converted.addedTools) toolNames.add(t)
        if (converted.media.length > 0) {
          result.push(synthesizeMediaMessage(converted.media))
        }
      }
    }
  }

  const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

  return yield* Effect.promise(() =>
    convertToModelMessages(
      result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
      {
        // @ts-expect-error -- convertToModelMessages expects ToolSet but only actually needs tools[name]?.toModelOutput
        tools,
      },
    ),
  )
})

export function toModelMessages(
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean },
): Promise<ModelMessage[]> {
  return Effect.runPromise(toModelMessagesEffect(input, model, options).pipe(Effect.provide(EffectLogger.layer)))
}

export { cursor, page, stream, parts, get, filterCompacted, filterCompactedEffect } from "./message-v2-store"

export { fromError } from "./message-from-error"

export * as MessageV2 from "./message-v2"
