import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { SandboxBroker } from "../../src/sandbox/broker"
import type { Interface as SandboxBrokerInterface } from "../../src/sandbox/broker"
import type { SandboxBackendStatus } from "../../src/sandbox/types"
import { MessageID, SessionID } from "../../src/session/schema"
import { ShellRunner, type RunInput } from "../../src/shell/runner"
import { Tool, Truncate } from "../../src/tool"

const timeout = (promise: Promise<void>, message: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), 1_000)
    }),
  ])

describe("ShellRunner", () => {
  test("passes auto backend and failure policy through to broker", async () => {
    const requests: Array<Parameters<SandboxBrokerInterface["exec"]>[0]["request"]> = []
    const brokerLayer = Layer.succeed(
      SandboxBroker.Service,
      SandboxBroker.Service.of({
        capabilities: () =>
          Effect.succeed([
            {
              name: "process",
              available: true,
              helper: "test-process-backend",
            } satisfies SandboxBackendStatus,
          ]),
        exec: (input) =>
          Effect.sync(() => {
            requests.push(input.request)
            return {
              request_id: input.request.request_id,
              exit_code: 0,
              termination_reason: "exit" as const,
              backend_used: "process" as const,
              stdout_tail: "",
              stderr_tail: "",
              policy_advisory: {
                enforcement: input.request.enforcement,
                backendPreference: input.request.backend_preference,
                filesystemPolicy: input.request.filesystem_policy,
                networkPolicy: input.request.network_policy,
                allowedPaths: input.request.allowed_paths,
                writablePaths: input.request.writable_paths,
                reportOnly: false,
                enforced: false,
                filesystemEnforced: false,
                networkEnforced: false,
              },
            }
          }),
      }),
    )
    const runtime = ManagedRuntime.make(
      ShellRunner.layer.pipe(Layer.provide(Truncate.defaultLayer), Layer.provide(brokerLayer)),
    )
    const ctx: Tool.Context = {
      sessionID: SessionID.make("ses_shell_runner_backend_policy"),
      messageID: MessageID.make("msg_shell_runner_backend_policy"),
      callID: "call_shell_runner_backend_policy",
      agent: "build",
      abort: AbortSignal.any([]),
      messages: [],
      metadata: () => Effect.void,
      ask: () => Effect.void,
    }

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ShellRunner.Service
          return yield* runner.run(
            {
              shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh",
              shellFamily: process.platform === "win32" ? "cmd" : "posix",
              command: "echo passthrough",
              cwd: process.cwd(),
              timeout: 1_000,
              description: "Backend policy passthrough",
              enforcement: "required",
              backendPreference: "auto",
              filesystemPolicy: "workspace_write",
              allowedPaths: [process.cwd()],
              writablePaths: [process.cwd()],
              networkPolicy: "none",
              reportOnly: false,
              failurePolicy: "closed",
              riskLevel: "high",
            },
            ctx,
          )
        }),
      )
      expect(requests).toHaveLength(1)
      expect(requests[0]?.backend_preference).toBe("auto")
      expect(requests[0]?.failure_policy).toBe("closed")
    } finally {
      await runtime.dispose()
    }
  })

  test("cleans streaming metadata fiber when broker execution fails", async () => {
    let startMetadata!: () => void
    let interruptMetadata!: () => void
    const metadataStarted = new Promise<void>((resolve) => {
      startMetadata = resolve
    })
    const metadataInterrupted = new Promise<void>((resolve) => {
      interruptMetadata = resolve
    })
    const brokerLayer = Layer.succeed(
      SandboxBroker.Service,
      SandboxBroker.Service.of({
        capabilities: () =>
          Effect.succeed([
            {
              name: "process",
              available: true,
              helper: "test-process-backend",
            } satisfies SandboxBackendStatus,
          ]),
        exec: (input) =>
          Effect.promise(async () => {
            input.onStdout("streamed")
            await timeout(metadataStarted, "metadata update did not start")
            throw new Error("broker exploded")
          }),
      }),
    )
    const runtime = ManagedRuntime.make(
      ShellRunner.layer.pipe(Layer.provide(Truncate.defaultLayer), Layer.provide(brokerLayer)),
    )
    const ctx: Tool.Context = {
      sessionID: SessionID.make("ses_shell_runner_cleanup"),
      messageID: MessageID.make("msg_shell_runner_cleanup"),
      callID: "call_shell_runner_cleanup",
      agent: "build",
      abort: AbortSignal.any([]),
      messages: [],
      metadata: (input) => {
        if (input.metadata?.output !== "streamed") return Effect.void
        startMetadata()
        return Effect.never.pipe(Effect.ensuring(Effect.sync(() => interruptMetadata())))
      },
      ask: () => Effect.void,
    }
    const command: RunInput = {
      shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh",
      shellFamily: process.platform === "win32" ? "cmd" : "posix",
      command: "echo streamed",
      cwd: process.cwd(),
      timeout: 1_000,
      description: "Failing broker",
      enforcement: "advisory",
      backendPreference: "process",
      filesystemPolicy: "workspace_write",
      allowedPaths: [process.cwd()],
      writablePaths: [process.cwd()],
      networkPolicy: "none",
      reportOnly: false,
      failurePolicy: "fallback",
      riskLevel: "safe",
    }

    try {
      await expect(
        runtime.runPromise(
          Effect.gen(function* () {
            const runner = yield* ShellRunner.Service
            return yield* runner.run(command, ctx)
          }),
        ),
      ).rejects.toThrow("broker exploded")
      await expect(timeout(metadataInterrupted, "metadata fiber was not interrupted")).resolves.toBeUndefined()
    } finally {
      await runtime.dispose()
    }
  })
})
