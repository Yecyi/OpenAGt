import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer, Stream } from "effect"
import { GrepTool } from "../../src/tool/grep"
import { provideInstance, provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Truncate } from "../../src/tool"
import { Agent } from "../../src/agent/agent"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const itPartial = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Layer.succeed(
      Ripgrep.Service,
      Ripgrep.Service.of({
        files: () => Stream.empty,
        tree: () => Effect.succeed(""),
        search: () =>
          Effect.succeed({
            items: [
              {
                path: { text: "found.txt" },
                lines: { text: "needle\n" },
                line_number: 1,
                absolute_offset: 0,
                submatches: [],
              },
            ],
            partial: true,
            skipped_count: 2,
            skipped_reason_sample: "rg: skipped.txt: Access is denied. (os error 5)",
          }),
      }),
    ),
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const root = path.join(__dirname, "../..")

describe("tool.grep", () => {
  it.live("basic search", () =>
    Effect.gen(function* () {
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* provideInstance(root)(
        grep.execute(
          {
            pattern: "export",
            path: path.join(root, "src/tool"),
            include: "*.ts",
          },
          ctx,
        ),
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
      expect(result.output).toContain("Found")
    }),
  )

  it.live("no matches returns correct output", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "test.txt"), "hello world"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "xyznonexistentpatternxyz123",
            path: dir,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      }),
    ),
  )

  it.live("finds matches in tmp instance", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "test.txt"), "line1\nline2\nline3"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "line",
            path: dir,
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
      }),
    ),
  )

  it.live("supports exact file paths", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "test.txt")
        yield* Effect.promise(() => Bun.write(file, "line1\nline2\nline3"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "line2",
            path: file,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(1)
        expect(result.output).toContain(file)
        expect(result.output).toContain("Line 2: line2")
      }),
    ),
  )

  itPartial.live("surfaces skipped path metadata for partial searches", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "found.txt"), "needle\n"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "needle",
            path: dir,
          },
          ctx,
        )

        expect(result.metadata.partial).toBe(true)
        expect(result.metadata.search_complete).toBe(false)
        expect(result.metadata.skipped_count).toBe(2)
        expect(result.metadata.skipped_reason_sample).toContain("skipped.txt")
        expect(result.output).toContain("Search incomplete")
        expect(result.output).toContain("2 paths skipped")
      }),
    ),
  )
})
