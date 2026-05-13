import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { getSandboxStatus, SandboxStatusSchema } from "../../src/sandbox/status"
import { WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION } from "../../src/sandbox/windows-helper"
import type { SandboxBackendStatus } from "../../src/sandbox/types"
import { tmpdir } from "../fixture/fixture"

const helper = "C:\\OpenAGt\\bin\\openagt-sandbox-win.exe"

function status(patch: Partial<SandboxBackendStatus>) {
  return {
    name: "windows_native",
    available: false,
    helper,
    helper_path: helper,
    helper_version: "1.0.0",
    helper_protocol_version: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
    job_object_supported: true,
    filesystem_enforced: true,
    network_enforced: true,
    network_policies_enforced: ["none"],
    ...patch,
  } satisfies SandboxBackendStatus
}

function getWith(status: SandboxBackendStatus) {
  return getSandboxStatus({
    config: { experimental: { sandbox: { backend: "windows_native" } } },
    platform: "win32",
    execPath: "C:\\OpenAGt\\bin\\openagt.exe",
    exists: (candidate) => candidate === helper,
    probe: () => status,
  })
}

describe("sandbox status", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("distinguishes setup-required next action", () => {
    const result = getWith(
      status({
        readiness: "setup_required",
        setup_required: true,
        setup_reason: "WFP setup is missing",
      }),
    )

    expect(result.next_action.kind).toBe("install_setup")
    expect(result.next_action.command).toBe("openagt sandbox windows setup --install --json")
  })

  test("distinguishes admin-gate next action", () => {
    const result = getWith(
      status({
        readiness: "admin_verification_required",
        admin_verification_required: true,
        admin_gate_report_path: "C:\\repo\\.artifacts\\windows-sandbox\\admin-gate-report.json",
      }),
    )

    expect(result.next_action.kind).toBe("run_admin_gate")
    expect(result.next_action.command).toBe("bun run verify:windows-sandbox-admin")
  })

  test("distinguishes ACL apply next action", () => {
    const result = getWith(
      status({
        readiness: "acl_apply_required",
        filesystem_enforced: false,
      }),
    )

    expect(result.next_action.kind).toBe("enable_acl_apply")
    expect(result.backend_run_loop_enabled).toBe(false)
  })

  test("reports ready helper without a next command", () => {
    const result = getWith(
      status({
        available: true,
        readiness: "ready",
      }),
    )

    expect(result.backend_run_loop_enabled).toBe(true)
    expect(result.next_action.kind).toBe("none")
    expect(result.next_action.command).toBeUndefined()
  })

  test("returns parseable status contract", () => {
    const result = getWith(
      status({
        available: true,
        readiness: "ready",
      }),
    )

    expect(SandboxStatusSchema.parse(result).process.available).toBe(true)
  })

  test("serves parseable global route status", async () => {
    await using tmp = await tmpdir()
    const response = await Server.Default().app.request("/global/sandbox/status", {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(typeof SandboxStatusSchema.parse(await response.json()).next_action.kind).toBe("string")
  })
})
