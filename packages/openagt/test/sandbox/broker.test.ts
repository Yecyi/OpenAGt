import { describe, expect, test } from "bun:test"
import { Effect, ManagedRuntime } from "effect"
import path from "path"
import { brokerCommand } from "../../src/sandbox/broker"
import { SandboxBroker } from "../../src/sandbox/broker"
import { autoBackendName, powershellEncodedCommand } from "../../src/sandbox/backends"
import { selectBackend } from "../../src/sandbox/backend-selection"
import { createFrameParser, MAX_FRAME_BYTES } from "../../src/sandbox/protocol"
import type { SandboxBackendName, SandboxBackendStatus } from "../../src/sandbox/types"
import {
  resolveWindowsHelperPath,
  statusFromProbe,
  WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
} from "../../src/sandbox/windows-helper"

function backend(status: SandboxBackendStatus) {
  return { status }
}

function backendMap(items: SandboxBackendStatus[]) {
  return new Map(items.map((item) => [item.name, backend(item)] as [SandboxBackendName, ReturnType<typeof backend>]))
}

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
      expect.stringContaining(path.join("packages", "openagt", "src", "sandbox", "broker-main.ts")),
    ])
  })
})

describe("autoBackendName", () => {
  test("uses native backend for Windows auto sandbox", () => {
    expect(autoBackendName("win32")).toBe("windows_native")
  })

  test("keeps native defaults for supported unix platforms", () => {
    expect(autoBackendName("darwin")).toBe("seatbelt")
    expect(autoBackendName("linux")).toBe("landlock")
  })
})

describe("powershellEncodedCommand", () => {
  test("encodes commands as UTF-16LE base64 for PowerShell -EncodedCommand", () => {
    const command = `Write-Output "quoted value"`
    expect(Buffer.from(powershellEncodedCommand(command), "base64").toString("utf16le")).toBe(command)
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

describe("sandbox backend selection", () => {
  test("closed policy denies unavailable auto backend instead of falling back to process", () => {
    expect(
      selectBackend({
        backends: backendMap([
          { name: "windows_native", available: false, reason: "Windows native helper unavailable" },
          { name: "process", available: true, helper: "bun" },
        ]),
        backendPreference: "auto",
        failurePolicy: "closed",
        autoBackendName: "windows_native",
      }),
    ).toEqual({
      type: "deny",
      backendUsed: "windows_native",
      reason: "Windows native helper unavailable",
    })
  })

  test("fallback policy downgrades unavailable auto backend to process with reason", () => {
    expect(
      selectBackend({
        backends: backendMap([
          { name: "windows_native", available: false, reason: "Windows native helper unavailable" },
          { name: "process", available: true, helper: "bun" },
        ]),
        backendPreference: "auto",
        failurePolicy: "fallback",
        autoBackendName: "windows_native",
      }),
    ).toEqual({
      type: "run",
      backend: { name: "process", available: true, helper: "bun" },
      downgradeReason: "Windows native helper unavailable",
    })
  })

  test("closed policy denies native backend when requested network policy is not enforced", () => {
    expect(
      selectBackend({
        backends: backendMap([
          {
            name: "windows_native",
            available: true,
            filesystem_enforced: true,
            network_enforced: false,
          },
          { name: "process", available: true, helper: "bun" },
        ]),
        backendPreference: "auto",
        failurePolicy: "closed",
        autoBackendName: "windows_native",
        networkPolicy: "none",
      }),
    ).toEqual({
      type: "deny",
      backendUsed: "windows_native",
      reason: "windows_native does not enforce none network policy",
    })
  })
})

describe("Windows helper discovery", () => {
  test("prefers packaged helper over env override", () => {
    const result = resolveWindowsHelperPath({
      platform: "win32",
      execPath: "C:\\OpenAGt\\bin\\openagt.exe",
      override: "C:\\tmp\\override.exe",
      env: { OPENAGT_SANDBOX_ALLOW_HELPER_OVERRIDE: "1" },
      exists: (candidate) => candidate === "C:\\OpenAGt\\bin\\openagt-sandbox-win.exe" || candidate === "C:\\tmp\\override.exe",
    })

    expect(result.path).toBe("C:\\OpenAGt\\bin\\openagt-sandbox-win.exe")
  })

  test("rejects helper override outside dev/test when packaged helper is missing", () => {
    const result = resolveWindowsHelperPath({
      platform: "win32",
      execPath: "C:\\OpenAGt\\bin\\openagt.exe",
      override: "C:\\tmp\\override.exe",
      env: {},
      exists: (candidate) => candidate === "C:\\tmp\\override.exe",
    })

    expect(result.path).toBeUndefined()
    expect(result.reason).toContain("override ignored")
  })

  test("marks incompatible helper protocol unavailable", () => {
    expect(
      statusFromProbe("C:\\OpenAGt\\bin\\openagt-sandbox-win.exe", {
        helper_version: "1.0.0",
        helper_protocol_version: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION + 1,
        restricted_token_supported: true,
      }),
    ).toMatchObject({
      name: "windows_native",
      available: false,
      helper_protocol_version: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION + 1,
    })
  })

  test("requires filesystem enforcement before marking helper available", () => {
    expect(
      statusFromProbe("C:\\OpenAGt\\bin\\openagt-sandbox-win.exe", {
        helper_version: "1.0.0",
        helper_protocol_version: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
        restricted_token_supported: true,
        job_object_supported: true,
        filesystem_enforced: false,
        setup_reason: "Filesystem ACL enforcement is disabled by policy",
      }),
    ).toMatchObject({
      name: "windows_native",
      available: false,
      filesystem_enforced: false,
      reason: "Filesystem ACL enforcement is disabled by policy",
    })
  })

  test("keeps Job Object-only helpers unavailable until token and filesystem enforcement exist", () => {
    expect(
      statusFromProbe("C:\\OpenAGt\\bin\\openagt-sandbox-win.exe", {
        helper_version: "1.0.0",
        helper_protocol_version: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
        restricted_token_supported: false,
        job_object_supported: true,
        filesystem_enforced: false,
      }),
    ).toMatchObject({
      name: "windows_native",
      available: false,
      reason: "Windows helper does not support restricted tokens",
    })
  })

  test("accepts helper only when token, job object, and filesystem enforcement are present", () => {
    expect(
      statusFromProbe("C:\\OpenAGt\\bin\\openagt-sandbox-win.exe", {
        helper_version: "1.0.0",
        helper_protocol_version: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
        restricted_token_supported: true,
        job_object_supported: true,
        filesystem_enforced: true,
        network_enforced: false,
      }),
    ).toMatchObject({
      name: "windows_native",
      available: true,
      job_object_supported: true,
      filesystem_enforced: true,
      network_enforced: false,
    })
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
                failure_policy: "fallback",
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
