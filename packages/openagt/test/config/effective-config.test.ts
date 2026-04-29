import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { EffectiveConfigSnapshot } from "../../src/config/effective-config"
import { ConfigInstanceMergePipeline } from "../../src/config/instance-merge-pipeline"
import type { Info } from "../../src/config/info"

describe("effective config metadata", () => {
  test("allows sparse field source maps", () => {
    expect(
      EffectiveConfigSnapshot.parse({
        config: {},
        sources: [],
        field_sources: {},
      }).field_sources,
    ).toEqual({})
  })

  test("does not let legacy tools hide an explicit permission source", async () => {
    const pipeline = new ConfigInstanceMergePipeline()
    await Effect.runPromise(
      pipeline.merge("global-config", {
        permission: { bash: "ask" },
        tools: { write: false },
      } as Info),
    )

    pipeline.applyToolsPermissionCompatibility()

    expect(pipeline.result.permission?.bash).toBe("ask")
    expect(pipeline.result.permission?.edit).toBe("deny")
    expect(pipeline.snapshot().field_sources.permission?.id).toBe("global-config")
  })

  test("marks managed config as the effective source", async () => {
    const pipeline = new ConfigInstanceMergePipeline()
    await Effect.runPromise(pipeline.merge("global-config", { permission: { bash: "ask" } } as Info, "global"))
    pipeline.mergeConfigOnly("managed-preferences", { permission: { bash: "deny" } } as Info, "managed")

    expect(pipeline.result.permission?.bash).toBe("deny")
    expect(pipeline.snapshot().field_sources.permission).toMatchObject({
      id: "managed-preferences",
      scope: "managed",
    })
  })
})
