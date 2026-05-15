import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import path from "node:path"
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
    helper_sha256: "a".repeat(64),
    helper_protocol_version: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
    acl_apply_mode: "apply",
    setup_installed: true,
    setup_required: false,
    admin_verification_required: false,
    job_object_supported: true,
    filesystem_ready: true,
    filesystem_enforced: true,
    network_ready: true,
    network_enforced: true,
    network_policies_enforced: ["none"],
    ...patch,
  } satisfies SandboxBackendStatus
}

function writeAdminReport(file: string, patch: Record<string, unknown> = {}) {
  writeFileSync(
    file,
    JSON.stringify(
      {
        schema_version: 1,
        gate: "windows_sandbox_admin_execution",
        generated_at: "2026-05-15T00:00:00.000Z",
        status: "passed",
        helper: {
          helper_version: "1.0.0",
          helper_protocol_version: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
          helper_sha256: "a".repeat(64),
        },
        results: [{ name: "Windows sandbox WFP execution gate", status: "passed" }],
        ...patch,
      },
      null,
      2,
    ),
  )
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
    expect(result.ready_for_default_on).toBe(false)
    expect(result.default_on_blockers).toContain("admin_gate_missing_or_stale")
    expect(result.next_action.kind).toBe("none")
    expect(result.next_action.command).toBeUndefined()
  })

  test("missing admin gate report blocks default-on readiness", () => {
    const result = getWith(
      status({
        available: true,
        readiness: "ready",
        admin_gate_report_path: "C:\\missing\\admin-gate-report.json",
      }),
    )

    expect(result.native_sandbox_ready).toBe(true)
    expect(result.ready_for_default_on).toBe(false)
    expect(result.admin_gate_report_valid).toBe(false)
    expect(result.default_on_blockers).toContain("admin_gate_missing_or_stale")
  })

  test("stale helper proof blocks default-on readiness", async () => {
    await using tmp = await tmpdir()
    const report = path.join(tmp.path, "admin-gate-report.json")
    writeAdminReport(report, {
      helper: {
        helper_version: "0.0.0",
        helper_protocol_version: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
        helper_sha256: "a".repeat(64),
      },
    })

    const result = getWith(
      status({
        available: true,
        readiness: "ready",
        admin_gate_report_path: report,
      }),
    )

    expect(result.admin_gate_report_valid).toBe(false)
    expect(result.ready_for_default_on).toBe(false)
    expect(result.default_on_blockers).toContain("admin_gate_missing_or_stale")
  })

  test("failed admin gate steps block default-on readiness", async () => {
    await using tmp = await tmpdir()
    const report = path.join(tmp.path, "admin-gate-report.json")
    writeAdminReport(report, {
      results: [{ name: "Windows sandbox WFP execution gate", status: "failed" }],
    })

    const result = getWith(
      status({
        available: true,
        readiness: "ready",
        admin_gate_report_path: report,
      }),
    )

    expect(result.admin_gate_report_valid).toBe(false)
    expect(result.ready_for_default_on).toBe(false)
    expect(result.default_on_blockers).toContain("admin_gate_missing_or_stale")
  })

  test("ACL preflight blocks default-on readiness", async () => {
    await using tmp = await tmpdir()
    const report = path.join(tmp.path, "admin-gate-report.json")
    writeAdminReport(report)

    const result = getWith(
      status({
        available: false,
        readiness: "acl_apply_required",
        acl_apply_mode: "preflight",
        filesystem_enforced: false,
        admin_gate_report_path: report,
      }),
    )

    expect(result.admin_gate_report_valid).toBe(true)
    expect(result.acl_apply_verified).toBe(false)
    expect(result.ready_for_default_on).toBe(false)
    expect(result.default_on_blockers).toContain("acl_apply_not_enabled")
  })

  test("valid admin report and ACL apply evidence allows default-on readiness", async () => {
    await using tmp = await tmpdir()
    const report = path.join(tmp.path, "admin-gate-report.json")
    writeAdminReport(report)

    const result = getWith(
      status({
        available: true,
        readiness: "ready",
        admin_gate_report_path: report,
      }),
    )

    expect(result.admin_gate_report_valid).toBe(true)
    expect(result.acl_apply_verified).toBe(true)
    expect(result.ready_for_default_on).toBe(true)
    expect(result.default_on_blockers).toEqual([])
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
