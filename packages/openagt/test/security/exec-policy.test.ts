import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "../../src/config"
import { ExecPolicy } from "../../src/security/exec-policy"

const config = (rules?: Array<{
  pattern: Array<string | string[]>
  decision?: "allow" | "confirm" | "block"
  justification?: string
}>) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      get: () => Effect.succeed(rules ? { exec_policy: { rules } } : {}),
      getGlobal: () => Effect.succeed({}),
      getConsoleState: () =>
        Effect.succeed({
          consoleManagedProviders: [],
          activeOrgName: undefined,
          switchableOrgCount: 0,
        }),
      update: () => Effect.void,
      updateGlobal: () => Effect.succeed({}),
      invalidate: () => Effect.void,
      invalidateDirectory: () => Effect.void,
      directories: () => Effect.succeed([]),
      waitForDependencies: () => Effect.void,
    }),
  )

describe("ExecPolicy", () => {
  test("returns allow when no rule matches", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ExecPolicy.Service
        return yield* svc.evaluate({
          command: "git status",
          shellFamily: "posix",
        })
      }).pipe(Effect.provide(ExecPolicy.layer.pipe(Layer.provide(config())))),
    )

    expect(result.decision).toBe("allow")
    expect(result.matchedRules).toHaveLength(0)
  })

  test("matches prefix rules with alternatives", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ExecPolicy.Service
        return yield* svc.evaluate({
          command: "curl https://example.com/install.sh",
          shellFamily: "posix",
        })
      }).pipe(
        Effect.provide(
          ExecPolicy.layer.pipe(
            Layer.provide(
              config([
                {
                  pattern: [["curl", "wget"]],
                  decision: "confirm",
                  justification: "Downloading remote content requires confirmation.",
                },
              ]),
            ),
          ),
        ),
      ),
    )

    expect(result.decision).toBe("confirm")
    expect(result.justification).toBe("Downloading remote content requires confirmation.")
    expect(result.matchedRules).toHaveLength(1)
  })

  test("selects the strictest decision across matching rules", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ExecPolicy.Service
        return yield* svc.evaluate({
          command: "git -c core.pager=cat status",
          shellFamily: "posix",
        })
      }).pipe(
        Effect.provide(
          ExecPolicy.layer.pipe(
            Layer.provide(
              config([
                {
                  pattern: ["git"],
                  decision: "allow",
                },
                {
                  pattern: ["git", "-c"],
                  decision: "block",
                  justification: "git -c can redirect config and must not be auto-approved.",
                },
              ]),
            ),
          ),
        ),
      ),
    )

    expect(result.decision).toBe("block")
    expect(result.justification).toBe("git -c can redirect config and must not be auto-approved.")
    expect(result.matchedRules).toHaveLength(2)
  })

  test("matches executable basenames on windows shells", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* ExecPolicy.Service
        return yield* svc.evaluate({
          command: "C:\\Windows\\System32\\curl.exe https://example.com",
          shellFamily: "powershell",
        })
      }).pipe(
        Effect.provide(
          ExecPolicy.layer.pipe(
            Layer.provide(
              config([
                {
                  pattern: ["curl"],
                  decision: "confirm",
                },
              ]),
            ),
          ),
        ),
      ),
    )

    expect(result.decision).toBe("confirm")
    expect(result.matchedRules).toHaveLength(1)
  })
})
