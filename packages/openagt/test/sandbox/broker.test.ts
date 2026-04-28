import { describe, expect, test } from "bun:test"
import { Effect, ManagedRuntime } from "effect"
import { brokerCommand } from "../../src/sandbox/broker"
import { SandboxBroker } from "../../src/sandbox/broker"
import { autoBackendName } from "../../src/sandbox/backends"
import { createFrameParser, MAX_FRAME_BYTES } from "../../src/sandbox/protocol"

describe("brokerCommand", () => {
  test("restarts the packaged binary instead of resolving broker-main.ts", () => {
    expect(
      brokerCommand(["C:\\OpenAGt\\openagt.exe", "C:\\OpenAGt\\openagt.exe"], "C:\\OpenAGt\\openagt.exe", []),
    ).toEqual(["C:\\OpenAGt\\openagt.exe"])
  })

  test("uses direct source broker when running from TypeScript", () => {
    expect(
      brokerCommand(["bun", "C:\\repo\\packages\\openagt\\src\\index.ts"], "C:\\Bun\\bun.exe", ["--smol"]),
    ).toEqual([
      "C:\\Bun\\bun.exe",
      "--smol",
      expect.stringContaining("packages\\openagt\\src\\sandbox\\broker-main.ts"),
    ])
  })
})

describe("autoBackendName", () => {
  test("uses process backend for Windows auto sandbox", () => {
    expect(autoBackendName("win32")).toBe("process")
  })

  test("keeps native defaults for supported unix platforms", () => {
    expect(autoBackendName("darwin")).toBe("seatbelt")
    expect(autoBackendName("linux")).toBe("landlock")
  })
})

describe("sandbox frame parser", () => {
  test("rejects frames larger than the protocol limit", () => {
    const errors: Error[] = []
    const parser = createFrameParser(
      () => {
        throw new Error("unexpected frame")
      },
      (error) => errors.push(error),
    )
    parser(new TextEncoder().encode((MAX_FRAME_BYTES + 1).toString(16).padStart(8, "0")))

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain("maximum size")
  })
})

describe("SandboxBroker abort", () => {
  test("rejects an already-aborted request before sending start", async () => {
    const runtime = ManagedRuntime.make(SandboxBroker.defaultLayer)
    const controller = new AbortController()
    controller.abort()

    try {
      await expect(
        runtime.runPromise(
          Effect.gen(function* () {
            const broker = yield* SandboxBroker.Service
            return yield* broker.exec({
              request: {
                request_id: "abort-before-start",
                command: "echo should-not-run",
                shell_family: "cmd",
                shell: process.env.COMSPEC || "cmd.exe",
                cwd: process.cwd(),
                timeout_ms: 5_000,
                description: "Abort before start",
                env: { SystemRoot: process.env.SystemRoot || "C:\\Windows" },
                env_policy: "sanitize",
                enforcement: "advisory",
                backend_preference: "process",
                filesystem_policy: "workspace_write",
                allowed_paths: [process.cwd()],
                writable_paths: [process.cwd()],
                network_policy: "none",
              },
              abort: controller.signal,
              onStdout: () => {
                throw new Error("unexpected stdout")
              },
              onStderr: () => {
                throw new Error("unexpected stderr")
              },
            })
          }),
        ),
      ).rejects.toThrow("Command aborted before start")
    } finally {
      await runtime.dispose()
    }
  })
})
