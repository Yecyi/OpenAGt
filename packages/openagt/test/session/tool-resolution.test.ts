import { describe, expect, test } from "bun:test"
import { createToolScheduler } from "../../src/session/prompt/tool-resolution"

describe("session prompt tool scheduler", () => {
  test("runs read-only explore task calls concurrently", async () => {
    const scheduler = createToolScheduler()
    let active = 0
    let peak = 0

    await Promise.all(
      ["structure", "runtime", "memory"].map((name) =>
        scheduler.schedule(
          {
            toolCallId: `task-${name}`,
            toolName: "task",
            input: {
              description: name,
              prompt: `Explore ${name}`,
              subagent_type: "explore",
            },
          },
          async () => {
            active++
            peak = Math.max(peak, active)
            await Bun.sleep(20)
            active--
            return name
          },
        ),
      ),
    )

    expect(peak).toBe(3)
  })

  test("caps direct read-only task concurrency", async () => {
    const scheduler = createToolScheduler({ maxParallelSafeTasks: 2 })
    let active = 0
    let peak = 0

    await Promise.all(
      ["structure", "runtime", "memory", "tests"].map((name) =>
        scheduler.schedule(
          {
            toolCallId: `task-${name}`,
            toolName: "task",
            input: {
              description: name,
              prompt: `Explore ${name}`,
              subagent_type: "explore",
            },
          },
          async () => {
            active++
            peak = Math.max(peak, active)
            await Bun.sleep(20)
            active--
            return name
          },
        ),
      ),
    )

    expect(peak).toBe(2)
  })

  test("rechecks safe task capacity after queued waiters resume", async () => {
    const scheduler = createToolScheduler({ maxParallelSafeTasks: 1 })
    let active = 0
    let peak = 0
    const run = (name: string, delay: number) =>
      scheduler.schedule(
        {
          toolCallId: `task-${name}`,
          toolName: "task",
          input: {
            description: name,
            prompt: `Explore ${name}`,
            subagent_type: "explore",
          },
        },
        async () => {
          active++
          peak = Math.max(peak, active)
          await Bun.sleep(delay)
          active--
          return name
        },
      )

    const first = run("first", 20)
    const queued = run("queued", 5)
    await Bun.sleep(21)
    const late = run("late", 5)
    await Promise.all([first, queued, late])

    expect(peak).toBe(1)
  })

  test("keeps implement task calls serialized", async () => {
    const scheduler = createToolScheduler()
    const order: string[] = []

    await Promise.all(
      ["a", "b"].map((name) =>
        scheduler.schedule(
          {
            toolCallId: `task-${name}`,
            toolName: "task",
            input: {
              description: name,
              prompt: `Implement ${name}`,
              subagent_type: "general",
              task_kind: "implement",
              write_scope: ["packages/openagt/src"],
            },
          },
          async () => {
            order.push(`start-${name}`)
            await Bun.sleep(20)
            order.push(`end-${name}`)
            return name
          },
        ),
      ),
    )

    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"])
  })
})
