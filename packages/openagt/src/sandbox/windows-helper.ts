import path from "path"
import { createHash } from "crypto"
import { existsSync, readFileSync } from "fs"
import type { SandboxBackendStatus, SandboxNativeReadiness, SandboxNetworkPolicy } from "./types"

export const WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION = 1
export const WINDOWS_SANDBOX_HELPER_NAME = "openagt-sandbox-win.exe"

export type WindowsSandboxHelperProbe = {
  helper_version: string
  helper_protocol_version: number
  helper_path?: string
  helper_sha256?: string
  windows_build?: string
  readiness?: SandboxNativeReadiness
  acl_apply_mode?: "preflight" | "dry_run" | "apply"
  elevated?: boolean
  restricted_token_supported?: boolean
  job_object_supported?: boolean
  wfp_supported?: boolean
  setup_installed?: boolean
  setup_version?: string
  setup_required?: boolean
  setup_reason?: string
  filesystem_ready?: boolean
  filesystem_enforced?: boolean
  filesystem_reason?: string
  network_ready?: boolean
  network_enforced?: boolean
  network_reason?: string
  network_policies_enforced?: SandboxNetworkPolicy[]
  admin_verification_required?: boolean
  admin_gate_report_path?: string
  admin_gate_verified_at?: string
  capabilities?: string[]
}

export type WindowsSandboxSetupResult = {
  ok: boolean
  mode: "install" | "uninstall" | "status"
  readiness?: SandboxNativeReadiness
  setup_installed: boolean
  setup_version?: string
  setup_required: boolean
  setup_reason?: string
  elevated?: boolean
  restricted_token_supported?: boolean
  job_object_supported?: boolean
  wfp_supported?: boolean
  filesystem_ready?: boolean
  filesystem_enforced?: boolean
  filesystem_reason?: string
  network_ready?: boolean
  network_enforced?: boolean
  network_reason?: string
  network_policies_enforced?: SandboxNetworkPolicy[]
  admin_verification_required?: boolean
  admin_gate_report_path?: string
  admin_gate_verified_at?: string
}

export function helperOverrideAllowed(env = process.env) {
  return env.OPENAGT_DEV === "1" || env.BUN_ENV === "test" || env.OPENAGT_SANDBOX_ALLOW_HELPER_OVERRIDE === "1"
}

export function packagedHelperPath(execPath = process.execPath) {
  return path.join(path.dirname(execPath), WINDOWS_SANDBOX_HELPER_NAME)
}

export function resolveWindowsHelperPath(input: {
  platform?: NodeJS.Platform
  execPath?: string
  override?: string
  env?: NodeJS.ProcessEnv
  exists?: (candidate: string) => boolean
} = {}) {
  if ((input.platform ?? process.platform) !== "win32") {
    return { path: undefined, reason: "Windows native helper is only supported on Windows", source: undefined }
  }
  const exists = input.exists ?? existsSync
  const packaged = packagedHelperPath(input.execPath)
  if (exists(packaged)) return { path: packaged, reason: undefined, source: "packaged" as const }
  if (input.override && !helperOverrideAllowed(input.env)) {
    return {
      path: undefined,
      reason: "Windows helper override ignored outside dev/test; packaged helper unavailable",
      source: undefined,
    }
  }
  if (input.override && exists(input.override)) return { path: input.override, reason: undefined, source: "override" as const }
  return {
    path: undefined,
    reason: input.override ? `Windows helper not found: ${input.override}` : "Windows native helper unavailable",
    source: undefined,
  }
}

function helperSha256(helper: string) {
  try {
    return createHash("sha256").update(readFileSync(helper)).digest("hex")
  } catch {
    return undefined
  }
}

function readinessReason(readiness: SandboxNativeReadiness | undefined) {
  if (readiness === "helper_missing") return "Windows native helper is missing"
  if (readiness === "helper_version_mismatch") return "Windows helper protocol or version is incompatible"
  if (readiness === "setup_required") return "Windows sandbox setup is required before native sandbox can be default-on"
  if (readiness === "admin_verification_required") return "Windows sandbox admin verification gate has not passed"
  if (readiness === "acl_apply_required") return "Windows filesystem ACL enforcement is not enabled"
  if (readiness === "network_policy_unsupported") return "Requested Windows sandbox network policy is not supported"
  if (readiness === "backend_unavailable") return "Windows native sandbox backend is unavailable"
}

function statusBase(helper: string, probe: WindowsSandboxHelperProbe) {
  return {
    helper,
    helper_path: probe.helper_path ?? helper,
    helper_version: probe.helper_version,
    helper_sha256: probe.helper_sha256,
    helper_protocol_version: probe.helper_protocol_version,
    readiness: probe.readiness,
    acl_apply_mode: probe.acl_apply_mode,
    admin_verification_required: probe.admin_verification_required,
    admin_gate_report_path: probe.admin_gate_report_path,
    admin_gate_verified_at: probe.admin_gate_verified_at,
    setup_required: probe.setup_required,
    setup_reason: probe.setup_reason,
    setup_installed: probe.setup_installed,
    setup_version: probe.setup_version,
    job_object_supported: probe.job_object_supported,
    filesystem_ready: probe.filesystem_ready,
    filesystem_enforced: probe.filesystem_enforced,
    filesystem_reason: probe.filesystem_reason,
    network_ready: probe.network_ready,
    network_enforced: probe.network_enforced ?? false,
    network_reason: probe.network_reason,
    network_policies_enforced: probe.network_policies_enforced ?? [],
  }
}

export function statusFromProbe(helper: string, probe: WindowsSandboxHelperProbe): SandboxBackendStatus {
  const readiness = probe.readiness ?? "backend_unavailable"
  if (probe.helper_protocol_version !== WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION) {
    return {
      name: "windows_native",
      available: false,
      ...statusBase(helper, { ...probe, readiness: "helper_version_mismatch" }),
      reason: `Windows helper protocol mismatch: expected ${WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION}, got ${probe.helper_protocol_version}`,
    }
  }
  if (!probe.restricted_token_supported) {
    return {
      name: "windows_native",
      available: false,
      ...statusBase(helper, { ...probe, readiness: "backend_unavailable" }),
      reason: "Windows helper does not support restricted tokens",
    }
  }
  if (!probe.job_object_supported) {
    return {
      name: "windows_native",
      available: false,
      ...statusBase(helper, { ...probe, readiness: "backend_unavailable" }),
      reason: "Windows helper does not support Job Object containment",
    }
  }
  if (!probe.filesystem_enforced) {
    return {
      name: "windows_native",
      available: false,
      ...statusBase(helper, { ...probe, readiness: probe.readiness ?? "acl_apply_required" }),
      filesystem_enforced: false,
      reason:
        probe.filesystem_reason ??
        probe.setup_reason ??
        readinessReason(probe.readiness ?? "acl_apply_required") ??
        "Windows helper filesystem enforcement is not enabled",
    }
  }
  if (readiness !== "ready") {
    return {
      name: "windows_native",
      available: false,
      ...statusBase(helper, { ...probe, readiness }),
      reason: readinessReason(readiness) ?? "Windows native helper readiness gate has not passed",
    }
  }
  return {
    name: "windows_native",
    available: true,
    ...statusBase(helper, { ...probe, readiness }),
    filesystem_enforced: probe.filesystem_enforced ?? true,
  }
}

export function probeWindowsHelper(helper: string): SandboxBackendStatus {
  const result = Bun.spawnSync({
    cmd: [helper, "probe", "--json"],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 2_000,
  })
  if (result.exitCode !== 0) {
    return {
      name: "windows_native",
      available: false,
      helper,
      reason: new TextDecoder().decode(result.stderr).trim() || `Windows helper probe failed with ${result.exitCode}`,
    }
  }
  try {
    return statusFromProbe(helper, {
      ...(JSON.parse(new TextDecoder().decode(result.stdout)) as WindowsSandboxHelperProbe),
      helper_path: helper,
      helper_sha256: helperSha256(helper),
    })
  } catch (error) {
    return {
      name: "windows_native",
      available: false,
      helper,
      reason: `Windows helper probe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function runWindowsHelperSetup(helper: string, mode: WindowsSandboxSetupResult["mode"]): WindowsSandboxSetupResult {
  const result = Bun.spawnSync({
    cmd: [helper, "setup", `--${mode}`, "--json"],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 30_000,
  })
  if (result.exitCode !== 0) {
    return {
      ok: false,
      mode,
      setup_installed: false,
      setup_required: true,
      setup_reason: new TextDecoder().decode(result.stderr).trim() || `Windows helper setup failed with ${result.exitCode}`,
    }
  }
  try {
    return JSON.parse(new TextDecoder().decode(result.stdout)) as WindowsSandboxSetupResult
  } catch (error) {
    return {
      ok: false,
      mode,
      setup_installed: false,
      setup_required: true,
      setup_reason: `Windows helper setup returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
