import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Coordinator } from "../../src/coordinator/coordinator"
import { PersonalAgent } from "../../src/personal/personal"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskRuntime } from "../../src/session/task-runtime"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

afterEach(async () => {
  await Instance.disposeAll()
})

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
  experimental: {
    sandbox: {
      backend: "process",
      failure_policy: "fallback",
    },
  },
} as const satisfies Partial<Config.Info>

function providerCfg(url: string): Partial<Config.Info> {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const it = testEffect(
  Layer.mergeAll(
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    TaskRuntime.defaultLayer,
    TestLLMServer.layer,
    SessionPrompt.defaultLayer,
    Coordinator.defaultLayer,
    PersonalAgent.defaultLayer,
  ),
)

describe("coordinator runner", () => {
  it.live("auto-dispatches runnable nodes to session prompt and synthesizes memory", () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const tasks = yield* TaskRuntime.Service
          const coordinator = yield* Coordinator.Service
          const personal = yield* PersonalAgent.Service
          yield* llm.text("researched")
          yield* llm.text("implemented")
          yield* llm.text("verified")

          const parent = yield* sessions.create({ title: "Coordinator runner parent" })
          yield* personal.listMemory({ projectID: parent.projectID })
          const run = yield* coordinator.run({
            sessionID: parent.id,
            goal: "Run coordinator automatically",
          })

          const waited = yield* tasks.wait({
            parentSessionID: parent.id,
            taskIDs: run.task_ids.map((item) => item as never),
            mode: "all",
            timeoutMs: 10000,
          })
          const projection = yield* coordinator.projection(run.id)
          yield* Effect.sleep("20 millis")
          const memory = yield* personal.listMemory({ projectID: parent.projectID })

          expect(waited).toHaveLength(3)
          expect(projection.counts.completed).toBe(3)
          expect(memory.some((item) => item.tags.includes(`coordinator_run:${run.id}`))).toBe(true)
          expect(memory.some((item) => item.tags.some((tag) => tag.startsWith("verify_task:")))).toBe(true)
        }),
      {
        config: providerCfg,
      },
    ),
  )
})
