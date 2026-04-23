import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { TaskRuntime } from "../../src/session/task-runtime"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Session.defaultLayer, TaskRuntime.defaultLayer))

describe("task runtime agentic scheduling", () => {
  it.live("allows implement tasks with distinct write_scope to run in parallel", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Agentic task runtime" })
        const first = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_scope_a" as never,
          taskKind: "implement",
          subagentType: "general",
          description: "first implement",
          prompt: "update src/a.ts",
          dependsOn: [],
          writeScope: ["src/a.ts"],
        })
        yield* tasks.setRunning(first.task_id, parent.id)
        const second = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_scope_b" as never,
          taskKind: "implement",
          subagentType: "general",
          description: "second implement",
          prompt: "update src/b.ts",
          dependsOn: [],
          writeScope: ["src/b.ts"],
        })

        expect(
          yield* tasks.canRun({
            parentSessionID: parent.id,
            task: second,
          }),
        ).toBe(true)
      }),
    ),
  )

  it.live("allows verify tasks to run beside implement tasks when read_scope does not overlap", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Agentic verify runtime" })
        const implement = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_verify_impl" as never,
          taskKind: "implement",
          subagentType: "general",
          description: "implement task",
          prompt: "change src/a.ts",
          dependsOn: [],
          writeScope: ["src/a.ts"],
        })
        yield* tasks.setRunning(implement.task_id, parent.id)
        const verify = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_verify_reader" as never,
          taskKind: "verify",
          subagentType: "general",
          description: "verify task",
          prompt: "check src/b.ts",
          dependsOn: [],
          readScope: ["src/b.ts"],
        })

        expect(
          yield* tasks.canRun({
            parentSessionID: parent.id,
            task: verify,
          }),
        ).toBe(true)
      }),
    ),
  )
})
