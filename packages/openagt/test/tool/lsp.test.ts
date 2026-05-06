import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { LSP } from "../../src/lsp"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { LspTool } from "../../src/tool/lsp"
import { Tool, Truncate } from "../../src/tool"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { tmpdir } from "../fixture/fixture"

const ctx: Tool.Context<{ result: readonly Tool.MetadataValue[] }> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function makeRuntime(hoverResult: unknown) {
  return ManagedRuntime.make(
    Layer.mergeAll(
      AppFileSystem.defaultLayer,
      Truncate.defaultLayer,
      Agent.defaultLayer,
      Layer.succeed(
        LSP.Service,
        LSP.Service.of({
          init: () => Effect.void,
          status: () => Effect.succeed([]),
          hasClients: () => Effect.succeed(true),
          touchFile: () => Effect.void,
          diagnostics: () => Effect.succeed({}),
          hover: () => Effect.succeed(hoverResult),
          definition: () => Effect.succeed([]),
          references: () => Effect.succeed([]),
          implementation: () => Effect.succeed([]),
          documentSymbol: () => Effect.succeed([]),
          workspaceSymbol: () => Effect.succeed([]),
          prepareCallHierarchy: () => Effect.succeed([]),
          incomingCalls: () => Effect.succeed([]),
          outgoingCalls: () => Effect.succeed([]),
        }),
      ),
    ),
  )
}

async function executeHover(hoverResult: unknown) {
  const runtime = makeRuntime(hoverResult)
  try {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "main.ts"), "const value = 1\n")
    return await Instance.provide({
      directory: tmp.path,
      fn: () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const info = yield* LspTool
            const tool = yield* info.init()
            return yield* tool.execute(
              {
                operation: "hover",
                filePath: path.join(tmp.path, "main.ts"),
                line: 1,
                character: 1,
              },
              ctx,
            )
          }),
        ),
    })
  } finally {
    await runtime.dispose()
  }
}

describe("tool.lsp", () => {
  test("normalizes hover object results into tool metadata and output", async () => {
    const result = await executeHover({
      contents: {
        kind: "markdown",
        value: "Hover details",
      },
    })

    expect(result.metadata.result).toHaveLength(1)
    expect(result.output).toContain("Hover details")
  })

  test("normalizes empty hover results to no-results output", async () => {
    const result = await executeHover(null)

    expect(result.metadata.result).toEqual([])
    expect(result.output).toBe("No results found for hover")
  })
})
