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
