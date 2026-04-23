import { describe, test, expect } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import z from "zod"
import { Agent } from "../../src/agent/agent"
import { Tool } from "../../src/tool"
import { Truncate } from "../../src/tool"
import { MessageID, SessionID } from "../../src/session/schema"

const runtime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

const params = z.object({ input: z.string() })
const richParams = z.object({ enabled: z.boolean() })

type RichMetadata = {
  truncated: boolean
  todos: {
    content: string
    done: boolean
  }[]
  answers: readonly (readonly string[])[]
  nested: {
    count: number
  }
}

function makeTool(id: string, executeFn?: () => void) {
  return {
    description: "test tool",
    parameters: params,
    execute() {
      executeFn?.()
      return Effect.succeed({ title: "test", output: "ok", metadata: {} })
    },
  }
}

describe("Tool.define", () => {
  test("object-defined tool does not mutate the original init object", async () => {
    const original = makeTool("test")
    const originalExecute = original.execute

    const info = await runtime.runPromise(Tool.define("test-tool", Effect.succeed(original)))

    await Effect.runPromise(info.init())
    await Effect.runPromise(info.init())
    await Effect.runPromise(info.init())

    expect(original.execute).toBe(originalExecute)
  })

  test("effect-defined tool returns fresh objects and is unaffected", async () => {
    const info = await runtime.runPromise(
      Tool.define(
        "test-fn-tool",
        Effect.succeed(() => Effect.succeed(makeTool("test"))),
      ),
    )

    const first = await Effect.runPromise(info.init())
    const second = await Effect.runPromise(info.init())

    expect(first).not.toBe(second)
  })

  test("object-defined tool returns distinct objects per init() call", async () => {
    const info = await runtime.runPromise(Tool.define("test-copy", Effect.succeed(makeTool("test"))))

    const first = await Effect.runPromise(info.init())
    const second = await Effect.runPromise(info.init())

    expect(first).not.toBe(second)
  })

  test("supports array metadata and typed execute context", async () => {
    let updated: RichMetadata | undefined
    const metadata = {
      truncated: false,
      todos: [{ content: "ship phase 2", done: false }],
      answers: [["yes", "later"]] as const,
      nested: { count: 1 },
    } satisfies RichMetadata

    const info = await runtime.runPromise(
      Tool.define<typeof richParams, RichMetadata, never>(
        "test-rich-metadata",
        Effect.succeed({
          description: "rich metadata tool",
          parameters: richParams,
          execute: (_args, ctx: Tool.Context<RichMetadata>) =>
            Effect.gen(function* () {
              yield* ctx.metadata({
                metadata,
              })
              return {
                title: "rich",
                output: "ok",
                metadata,
              }
            }),
        }),
      ),
    )

    const tool = await Effect.runPromise(info.init())
    const result = await Effect.runPromise(
      tool.execute(
        { enabled: true },
        {
          sessionID: SessionID.make("session"),
          messageID: MessageID.make("message"),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata: (input) =>
            Effect.sync(() => {
              updated = input.metadata
            }),
          ask: () => Effect.void,
        },
      ),
    )

    expect(updated?.todos[0]?.content).toBe("ship phase 2")
    expect(result.metadata.answers[0]).toEqual(["yes", "later"])
    expect(result.metadata.nested.count).toBe(1)
  })

  test("serializes circular metadata values without recursion overflow", () => {
    const cyclic: Record<string, unknown> = { name: "root" }
    cyclic["self"] = cyclic

    const result = Tool.toMetadataValue(cyclic)
    expect(typeof result).toBe("object")
    if (typeof result === "object" && result !== null && !Array.isArray(result)) {
      const record = result as Tool.Metadata
      expect(record["self"]).toBe("[circular]")
    }
  })

  test("caps metadata recursion depth", () => {
    const deep = { v: { v: { v: { v: { v: { v: { v: { v: { v: "leaf" } } } } } } } } }
    const result = Tool.toMetadataValue(deep)
    expect(JSON.stringify(result)).toContain("[max-depth]")
  })
})
