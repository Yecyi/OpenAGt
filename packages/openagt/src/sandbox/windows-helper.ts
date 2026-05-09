import path from "path"
import { existsSync } from "fs"
import type { SandboxBackendStatus } from "./types"

export const WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION = 1
export const WINDOWS_SANDBOX_HELPER_NAME = "openagt-sandbox-win.exe"

export type WindowsSandboxHelperProbe = {
  helper_version: string
  helper_protocol_version: number
  windows_build?: string
  elevated?: boolean
  restricted_token_supported?: boolean
  job_object_supported?: boolean
  wfp_supported?: boolean
  setup_installed?: boolean
  setup_version?: string
  setup_required?: boolean
  setup_reason?: string
  filesystem_enforced?: boolean
  network_enforced?: boolean
  capabilities?: string[]
}

export type WindowsSandboxSetupResult = {
  ok: boolean
  mode: "install" | "uninstall" | "status"
  setup_installed: boolean
  setup_version?: string
  setup_required: boolean
  setup_reason?: string
  elevated?: boolean
  restricted_token_supported?: boolean
  job_object_supported?: boolean
  wfp_supported?: boolean
  filesystem_enforced?: boolean
  network_enforced?: boolean
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

export function statusFromProbe(helper: string, probe: WindowsSandboxHelperProbe): SandboxBackendStatus {
  if (probe.helper_protocol_version !== WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION) {
    return {
      name: "windows_native",
      available: false,
      helper,
      helper_protocol_version: probe.helper_protocol_version,
      reason: `Windows helper protocol mismatch: expected ${WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION}, got ${probe.helper_protocol_version}`,
    }
  }
  if (!probe.restricted_token_supported) {
    return {
      name: "windows_native",
      available: false,
      helper,
      helper_protocol_version: probe.helper_protocol_version,
      reason: "Windows helper does not support restricted tokens",
    }
  }
  if (!probe.job_object_supported) {
    return {
      name: "windows_native",
      available: false,
      helper,
      helper_protocol_version: probe.helper_protocol_version,
      reason: "Windows helper does not support Job Object containment",
    }
  }
  if (!probe.filesystem_enforced) {
    return {
      name: "windows_native",
      available: false,
      helper,
      helper_protocol_version: probe.helper_protocol_version,
      job_object_supported: probe.job_object_supported,
      setup_required: probe.setup_required,
      setup_reason: probe.setup_reason,
      setup_installed: probe.setup_installed,
      setup_version: probe.setup_version,
      filesystem_enforced: false,
      network_enforced: probe.network_enforced ?? false,
      reason: probe.setup_reason ?? "Windows helper filesystem enforcement is not enabled",
    }
  }
  return {
    name: "windows_native",
    available: true,
    helper,
    helper_protocol_version: probe.helper_protocol_version,
    job_object_supported: probe.job_object_supported,
    setup_required: probe.setup_required,
    setup_reason: probe.setup_reason,
    setup_installed: probe.setup_installed,
    setup_version: probe.setup_version,
    filesystem_enforced: probe.filesystem_enforced ?? true,
    network_enforced: probe.network_enforced ?? false,
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
    return statusFromProbe(helper, JSON.parse(new TextDecoder().decode(result.stdout)) as WindowsSandboxHelperProbe)
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
