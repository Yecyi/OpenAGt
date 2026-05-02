import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { SystemPrompt } from "../../src/session/system"
import { provideInstance, tmpdir } from "../fixture/fixture"

function fakeModel(providerID: string, id: string): Provider.Model {
  return { providerID, api: { id } } as unknown as Provider.Model
}

const runEnvironment = (model: Provider.Model) =>
  Effect.gen(function* () {
    const svc = yield* SystemPrompt.Service
    return svc.environment(model)
  }).pipe(Effect.provide(SystemPrompt.defaultLayer))

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

describe("session.system", () => {
  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".opencode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await load(tmp.path, (svc) => svc.get("build"))
          const runSkills = Effect.gen(function* () {
            const svc = yield* SystemPrompt.Service
            return yield* svc.skills(build!)
          }).pipe(Effect.provide(SystemPrompt.defaultLayer))

          const first = await Effect.runPromise(runSkills)
          const second = await Effect.runPromise(runSkills)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  // Regression: environmentMemo is a process-global LRU. Before A1 the memo
  // key was the constant string "environment", so two distinct models served
  // by the same process would alias each other's static block (which embeds
  // model.providerID/model.api.id verbatim). After A1 the key is partitioned
  // by (providerID, api.id, directory, worktree, vcs, platform).
  test("environment cache returns model-specific content for distinct models", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await Effect.runPromise(runEnvironment(fakeModel("anthropic", "claude-opus-4-7")))
        const b = await Effect.runPromise(runEnvironment(fakeModel("openai", "gpt-5")))

        expect(a.static[0]).toContain("anthropic/claude-opus-4-7")
        expect(b.static[0]).toContain("openai/gpt-5")
        expect(a.static[0]).not.toContain("openai/gpt-5")
        expect(b.static[0]).not.toContain("anthropic/claude-opus-4-7")
      },
    })
  })

  // Regression: same constant memoKey caused cross-instance directory leak —
  // the second instance's environment() returned the first instance's
  // staticParts (which embeds Instance.directory and Instance.worktree).
  test("environment cache partitions by Instance.directory", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const model = fakeModel("anthropic", "claude-opus-4-7")

    const fromA = await Instance.provide({
      directory: tmpA.path,
      fn: async () => Effect.runPromise(runEnvironment(model)),
    })
    const fromB = await Instance.provide({
      directory: tmpB.path,
      fn: async () => Effect.runPromise(runEnvironment(model)),
    })

    expect(fromA.static[0]).toContain(tmpA.path)
    expect(fromB.static[0]).toContain(tmpB.path)
    expect(fromA.static[0]).not.toContain(tmpB.path)
    expect(fromB.static[0]).not.toContain(tmpA.path)
  })
})
