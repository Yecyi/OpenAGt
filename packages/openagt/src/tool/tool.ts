import z from "zod"
import { Effect } from "effect"
import type { MessageV2 } from "../session/message-v2"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import * as Truncate from "./truncate"
import { Agent } from "@/agent/agent"

export type MetadataValue = string | number | boolean | null | undefined | readonly MetadataValue[] | Metadata
export interface Metadata {
  [key: string]: MetadataValue
}

const METADATA_MAX_DEPTH = 8
const METADATA_MAX_ARRAY_ITEMS = 256
const METADATA_CIRCULAR = "[circular]"
const METADATA_MAX_DEPTH_REACHED = "[max-depth]"

function toMetadataValueInternal(value: unknown, depth: number, seen: WeakSet<object>): MetadataValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (depth >= METADATA_MAX_DEPTH) return METADATA_MAX_DEPTH_REACHED
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") return String(value)
  if (value instanceof Date) return value.toISOString()

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(typeof value.stack === "string" ? { stack: value.stack } : {}),
    }
  }

  if (Array.isArray(value)) {
    return value.slice(0, METADATA_MAX_ARRAY_ITEMS).map((item) => toMetadataValueInternal(item, depth + 1, seen))
  }

  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return METADATA_CIRCULAR

  seen.add(value)
  try {
    if (value instanceof Map) {
      return Array.from(value.entries())
        .slice(0, METADATA_MAX_ARRAY_ITEMS)
        .map(([key, item]) => ({
          key: toMetadataValueInternal(key, depth + 1, seen),
          value: toMetadataValueInternal(item, depth + 1, seen),
        }))
    }
    if (value instanceof Set) {
      return Array.from(value.values())
        .slice(0, METADATA_MAX_ARRAY_ITEMS)
        .map((item) => toMetadataValueInternal(item, depth + 1, seen))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return String(value)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toMetadataValueInternal(item, depth + 1, seen)]),
    )
  } finally {
    seen.delete(value)
  }
}

export function toMetadataValue(value: unknown): MetadataValue {
  return toMetadataValueInternal(value, 0, new WeakSet())
}

export function toMetadata(value: Record<string, unknown>): Metadata {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toMetadataValueInternal(item, 1, new WeakSet())]),
  )
}

// TODO: remove this hack
export type DynamicDescription = (agent: Agent.Info) => Effect.Effect<string>

export type Context<M extends Metadata = Metadata> = {
  sessionID: SessionID
  messageID: MessageID
  agent: string
  abort: AbortSignal
  callID?: string
  extra?: { [key: string]: unknown }
  messages: MessageV2.WithParts[]
  metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>
  ask(input: Omit<Permission.Request, "id" | "sessionID" | "tool">): Effect.Effect<void>
}

export interface ExecuteResult<M extends Metadata = Metadata> {
  title: string
  metadata: M
  output: string
  attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
}

export interface Def<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  description: string
  parameters: Parameters
  execute(args: z.infer<Parameters>, ctx: Context<M>): Effect.Effect<ExecuteResult<M>>
  formatValidationError?(error: z.ZodError): string
  isConcurrencySafe?: boolean
}
export type DefWithoutID<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> = Omit<
  Def<Parameters, M>,
  "id"
>

export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  init: () => Effect.Effect<DefWithoutID<Parameters, M>>
}

type Init<Parameters extends z.ZodType, M extends Metadata> =
  | DefWithoutID<Parameters, M>
  | (() => Effect.Effect<DefWithoutID<Parameters, M>>)

export type InferParameters<T> =
  T extends Info<infer P, any> ? z.infer<P> : T extends Effect.Effect<Info<infer P, any>, any, any> ? z.infer<P> : never
export type InferMetadata<T> =
  T extends Info<any, infer M> ? M : T extends Effect.Effect<Info<any, infer M>, any, any> ? M : never

export type InferDef<T> =
  T extends Info<infer P, infer M>
    ? Def<P, M>
    : T extends Effect.Effect<Info<infer P, infer M>, any, any>
      ? Def<P, M>
      : never

function wrap<Parameters extends z.ZodType, Result extends Metadata>(
  id: string,
  init: Init<Parameters, Result>,
  truncate: Truncate.Interface,
  agents: Agent.Interface,
): () => Effect.Effect<DefWithoutID<Parameters, Result>> {
  return () =>
    Effect.gen(function* () {
      const toolInfo = typeof init === "function" ? { ...(yield* init()) } : { ...init }
      const execute = toolInfo.execute
      toolInfo.execute = (args, ctx: Context<Result>) => {
        const attrs = {
          "tool.name": id,
          "session.id": ctx.sessionID,
          "message.id": ctx.messageID,
          ...(ctx.callID ? { "tool.call_id": ctx.callID } : {}),
        }
        return Effect.gen(function* () {
          yield* Effect.try({
            try: () => toolInfo.parameters.parse(args),
            catch: (error) => {
              if (error instanceof z.ZodError && toolInfo.formatValidationError) {
                return new Error(toolInfo.formatValidationError(error), { cause: error })
              }
              return new Error(
                `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
                { cause: error },
              )
            },
          })
          const result = yield* execute(args, ctx)
          if (result.metadata.truncated !== undefined) {
            return result
          }
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(result.output, {}, agent)
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }).pipe(Effect.orDie, Effect.withSpan("Tool.execute", { attributes: attrs }))
      }
      return toolInfo
    })
}

export function define<Parameters extends z.ZodType, Result extends Metadata, R, ID extends string = string>(
  id: ID,
  init: Effect.Effect<Init<Parameters, Result>, never, R>,
): Effect.Effect<Info<Parameters, Result>, never, R | Truncate.Service | Agent.Service> & { id: ID } {
  return Object.assign(
    Effect.gen(function* () {
      const resolved = yield* init
      const truncate = yield* Truncate.Service
      const agents = yield* Agent.Service
      return { id, init: wrap(id, resolved, truncate, agents) }
    }),
    { id },
  )
}

export function init<P extends z.ZodType, M extends Metadata>(info: Info<P, M>): Effect.Effect<Def<P, M>> {
  return Effect.gen(function* () {
    const init = yield* info.init()
    return {
      ...init,
      id: info.id,
    }
  })
}
