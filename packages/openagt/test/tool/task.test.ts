import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { TaskGetTool } from "../../src/tool/task_get"
import { TaskListTool } from "../../src/tool/task_list"
import { TaskStopTool } from "../../src/tool/task_stop"
import { TaskWaitTool } from "../../src/tool/task_wait"
import { Truncate } from "../../src/tool"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TaskRuntime } from "../../src/session/task-runtime"
import { ProviderTest } from "../fake/provider"

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    ProviderTest.fake().layer,
    Session.defaultLayer,
    TaskRuntime.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; onCancel?: (sessionID: SessionID) => void; text?: string }): TaskPromptOps {
  return {
    cancel(sessionID) {
      opts?.onCancel?.(sessionID)
    },
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("tool.task", () => {
  it.live("description sorts subagents by name and is stable across calls", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const build = yield* agent.get("build")
          const registry = yield* ToolRegistry.Service
          const get = Effect.fnUntraced(function* () {
            const tools = yield* registry.tools({ ...ref, agent: build })
            return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
          })
          const first = yield* get()
          const second = yield* get()

          expect(first).toBe(second)

          const alpha = first.indexOf("- alpha: Alpha agent")
          const explore = first.indexOf("- explore:")
          const general = first.indexOf("- general:")
          const zebra = first.indexOf("- zebra: Zebra agent")

          expect(alpha).toBeGreaterThan(-1)
          expect(explore).toBeGreaterThan(alpha)
          expect(general).toBeGreaterThan(explore)
          expect(zebra).toBeGreaterThan(general)
        }),
      {
        config: {
          agent: {
            zebra: {
              description: "Zebra agent",
              mode: "subagent",
            },
            alpha: {
              description: "Alpha agent",
              mode: "subagent",
            },
          },
        },
      },
    ),
  )

  it.live("description hides denied subagents for the caller", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const build = yield* agent.get("build")
          const registry = yield* ToolRegistry.Service
          const description =
            (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

          expect(description).toContain("- alpha: Alpha agent")
          expect(description).not.toContain("- zebra: Zebra agent")
        }),
      {
        config: {
          permission: {
            task: {
              "*": "allow",
              zebra: "deny",
            },
          },
          agent: {
            zebra: {
              description: "Zebra agent",
              mode: "subagent",
            },
            alpha: {
              description: "Alpha agent",
              mode: "subagent",
            },
          },
        },
      },
    ),
  )

  it.live("execute resumes an existing task session from task_id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            task_id: child.id,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)
        expect(kids[0]?.id).toBe(child.id)
        expect(result.metadata.sessionId).toBe(child.id)
        expect(result.output).toContain(`task_id: ${child.id}`)
        expect(seen?.sessionID).toBe(child.id)
      }),
    ),
  )

  it.live("execute asks by default and skips checks when bypassed", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const calls: unknown[] = []
        const promptOps = stubOps()

        const exec = (extra?: Record<string, any>) =>
          def.execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "general",
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps, ...extra },
              messages: [],
              metadata: () => Effect.void,
              ask: (input) =>
                Effect.sync(() => {
                  calls.push(input)
                }),
            },
          )

        yield* exec()
        yield* exec({ bypassAgentCheck: true })

        expect(calls).toHaveLength(1)
        expect(calls[0]).toEqual({
          permission: "task",
          patterns: ["general"],
          always: ["*"],
          metadata: {
            description: "inspect bug",
            subagent_type: "general",
          },
        })
      }),
    ),
  )

  it.live("execute creates a child when task_id does not exist", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            task_id: "ses_missing",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)
        expect(kids[0]?.id).toBe(result.metadata.sessionId)
        expect(result.metadata.sessionId).not.toBe("ses_missing")
        expect(result.output).toContain(`task_id: ${result.metadata.sessionId}`)
        expect(seen?.sessionID).toBe(result.metadata.sessionId)
      }),
    ),
  )

  it.live("execute shapes child permissions for task, todowrite, and primary tools", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const tool = yield* TaskTool
          const def = yield* tool.init()
          let seen: SessionPrompt.PromptInput | undefined
          const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

          const result = yield* def.execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "reviewer",
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          const child = yield* sessions.get(result.metadata.sessionId)
          expect(child.parentID).toBe(chat.id)
          expect(child.permission).toEqual([
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "bash",
              pattern: "*",
              action: "allow",
            },
            {
              permission: "read",
              pattern: "*",
              action: "allow",
            },
          ])
          expect(seen?.tools).toEqual({
            todowrite: false,
            bash: false,
            read: false,
          })
        }),
      {
        config: {
          agent: {
            reviewer: {
              mode: "subagent",
              permission: {
                task: "allow",
              },
            },
          },
          experimental: {
            primary_tools: ["bash", "read"],
          },
        },
      },
    ),
  )

  it.live("task runtime exposes task_list, task_get, task_wait, and task_stop", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const task = yield* TaskTool.pipe(Effect.flatMap((tool) => tool.init()))
        const taskList = yield* TaskListTool.pipe(Effect.flatMap((tool) => tool.init()))
        const taskGet = yield* TaskGetTool.pipe(Effect.flatMap((tool) => tool.init()))
        const taskWait = yield* TaskWaitTool.pipe(Effect.flatMap((tool) => tool.init()))
        const taskStop = yield* TaskStopTool.pipe(Effect.flatMap((tool) => tool.init()))
        const promptOps = stubOps({ text: "researched" })

        const result = yield* task.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            task_kind: "research",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const listed = yield* taskList.execute(
          {},
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        const taskID = result.metadata.taskId
        expect(taskID).toBeDefined()
        if (!taskID) throw new Error("Missing taskId")
        expect(listed.output).toContain(taskID)

        const got = yield* taskGet.execute(
          { task_id: taskID },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        expect(got.output).toContain("completed")

        const waited = yield* taskWait.execute(
          { task_ids: [taskID], mode: "all", timeout_ms: 1000 },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        expect(waited.output).toContain("completed")

        const stopped = yield* taskStop.execute(
          { task_id: taskID, reason: "user-stop" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        expect(stopped.output).toContain("cancelled")
      }),
    ),
  )

  it.live("explore subagents run with read-only tool restrictions", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        yield* def.execute(
          {
            description: "inspect project",
            prompt: "explore repository structure",
            subagent_type: "explore",
            task_kind: "research",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(seen?.tools).toMatchObject({
          bash: false,
          edit: false,
          write: false,
          multiedit: false,
          apply_patch: false,
        })
      }),
    ),
  )

  it.live("task_stop cancels an active raw task prompt", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const task = yield* TaskTool.pipe(Effect.flatMap((tool) => tool.init()))
        const taskStop = yield* TaskStopTool.pipe(Effect.flatMap((tool) => tool.init()))
        const started = yield* Deferred.make<SessionID>()
        const cancelled = yield* Deferred.make<SessionID>()
        const releasePrompt = yield* Deferred.make<void>()
        const calls: string[] = []
        const promptOps: TaskPromptOps = {
          cancel: (sessionID) => {
            calls.push("cancel")
            Deferred.doneUnsafe(cancelled, Effect.succeed(sessionID))
            Deferred.doneUnsafe(releasePrompt, Effect.void)
          },
          resolvePromptParts: (template) =>
            Effect.sync(() => {
              calls.push("resolve")
              return [{ type: "text" as const, text: template }]
            }),
          prompt: (input) =>
            Effect.gen(function* () {
              calls.push("prompt")
              Deferred.doneUnsafe(started, Effect.succeed(input.sessionID))
              yield* Deferred.await(releasePrompt)
              return reply(input, "stopped")
            }),
        }
        const ctx = {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.sync(() => calls.push("metadata")),
          ask: () => Effect.sync(() => calls.push("ask")),
        }
        const fiber = yield* task.execute(
          {
            description: "inspect slow",
            prompt: "wait until stopped",
            subagent_type: "general",
            task_kind: "research",
          },
          ctx,
        ).pipe(Effect.forkScoped)
        const taskID = yield* Deferred.await(started).pipe(
          Effect.timeout("1 second"),
          Effect.catchTag("TimeoutError", () => Effect.fail(new Error(`Task prompt did not start: ${calls.join(",")}`))),
        )

        const stopped = yield* taskStop.execute(
          { task_id: taskID, reason: "user-stop" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        const cancelledID = yield* Deferred.await(cancelled).pipe(Effect.timeout("1 second"))

        expect(cancelledID).toBe(taskID)
        expect(stopped.output).toContain("cancelled")
        yield* Fiber.join(fiber)
      }),
    ),
  )

  it.live("raw task prompt timeout cancels and marks task failed", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const task = yield* TaskTool.pipe(Effect.flatMap((tool) => tool.init()))
        const tasks = yield* TaskRuntime.Service
        const started = yield* Deferred.make<SessionID>()
        const cancelled = yield* Deferred.make<SessionID>()
        const promptOps: TaskPromptOps = {
          cancel: (sessionID) => {
            Deferred.doneUnsafe(cancelled, Effect.succeed(sessionID))
          },
          resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
          prompt: (input) =>
            Effect.gen(function* () {
              Deferred.doneUnsafe(started, Effect.succeed(input.sessionID))
              yield* Effect.never
              return reply(input, "unreachable")
            }),
        }
        const fiber = yield* task.execute(
          {
            description: "inspect timeout",
            prompt: "wait forever",
            subagent_type: "general",
            task_kind: "research",
            metadata: { timeout_ms: 20 },
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        ).pipe(Effect.forkScoped)

        const taskID = yield* Deferred.await(started).pipe(Effect.timeout("1 second"))
        const result = yield* Fiber.join(fiber)
        const cancelledID = yield* Deferred.await(cancelled).pipe(Effect.timeout("1 second"))
        const record = (yield* tasks.list(chat.id)).find((item) => item.task_id === taskID)

        expect(result.metadata.status).toBe("failed")
        expect(result.metadata.retryable).toBe(true)
        expect(result.output).toContain("<task_result status=\"failed\">")
        expect(cancelledID).toBe(taskID)
        expect(record?.status).toBe("failed")
        expect(record?.error_summary).toContain("Subagent timed out after")
      }),
    ),
  )

  it.live("implement tasks remain pending behind another running implement task", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tasks = yield* TaskRuntime.Service
        const { chat } = yield* seed()
        const first = yield* tasks.create({
          parentSessionID: chat.id,
          childSessionID: "ses_child_a" as never,
          taskKind: "implement",
          subagentType: "general",
          description: "first implement",
          prompt: "do first",
          dependsOn: [],
        })
        yield* tasks.setRunning(first.task_id, chat.id)
        const second = yield* tasks.create({
          parentSessionID: chat.id,
          childSessionID: "ses_child_b" as never,
          taskKind: "implement",
          subagentType: "general",
          description: "second implement",
          prompt: "do second",
          dependsOn: [],
        })
        const canRun = yield* tasks.canRun({ parentSessionID: chat.id, task: second })
        expect(canRun).toBe(false)
      }),
    ),
  )

  it.live("wait mode any returns only terminal matched tasks", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tasks = yield* TaskRuntime.Service
        const { chat } = yield* seed()
        const first = yield* tasks.create({
          parentSessionID: chat.id,
          childSessionID: "ses_child_any_done" as never,
          taskKind: "research",
          subagentType: "general",
          description: "done task",
          prompt: "do first",
          dependsOn: [],
        })
        const second = yield* tasks.create({
          parentSessionID: chat.id,
          childSessionID: "ses_child_any_pending" as never,
          taskKind: "research",
          subagentType: "general",
          description: "pending task",
          prompt: "do second",
          dependsOn: [],
        })

        yield* tasks.complete({
          taskID: first.task_id,
          parentSessionID: chat.id,
          output: "finished first",
        })

        const result = yield* tasks.wait({
          parentSessionID: chat.id,
          taskIDs: [first.task_id, second.task_id],
          mode: "any",
          timeoutMs: 1000,
        })

        expect(result).toHaveLength(1)
        expect(result[0]?.task_id).toBe(first.task_id)
        expect(result[0]?.status).toBe("completed")
      }),
    ),
  )
})
