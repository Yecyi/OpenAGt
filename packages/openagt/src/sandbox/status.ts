import z from "zod"
import { readFileSync } from "node:fs"
import { Flag } from "@/flag/flag"
import type { Config } from "@/config"
import { autoBackendName } from "./backends"
import { probeWindowsHelper, resolveWindowsHelperPath, WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION } from "./windows-helper"
import type {
  SandboxBackendName,
  SandboxBackendPreference,
  SandboxBackendStatus,
  SandboxConfig,
  SandboxFailurePolicy,
  SandboxNativeReadiness,
  SandboxNetworkPolicy,
  SandboxWindowsAclApplyMode,
} from "./types"

const SandboxBackendNameSchema = z.enum(["process", "seatbelt", "windows_native", "landlock"])
const SandboxBackendPreferenceSchema = z.enum(["auto", "process", "seatbelt", "windows_native", "landlock"])
const SandboxFailurePolicySchema = z.enum(["closed", "confirm_downgrade", "fallback"])
const SandboxAclModeSchema = z.enum(["preflight", "dry_run", "apply"])
const SandboxReadinessSchema = z.enum([
  "ready",
  "helper_missing",
  "helper_version_mismatch",
  "setup_required",
  "admin_verification_required",
  "acl_apply_required",
  "network_policy_unsupported",
  "backend_unavailable",
])
const SandboxNetworkPolicySchema = z.enum(["none", "loopback", "full"])

export const SandboxBackendStatusSchema = z
  .object({
    name: SandboxBackendNameSchema,
    available: z.boolean(),
    helper: z.string().optional(),
    helper_path: z.string().optional(),
    helper_version: z.string().optional(),
    helper_sha256: z.string().optional(),
    readiness: SandboxReadinessSchema.optional(),
    reason: z.string().optional(),
    setup_required: z.boolean().optional(),
    setup_reason: z.string().optional(),
    setup_installed: z.boolean().optional(),
    setup_version: z.string().optional(),
    helper_protocol_version: z.number().optional(),
    acl_apply_mode: SandboxAclModeSchema.optional(),
    admin_verification_required: z.boolean().optional(),
    admin_gate_report_path: z.string().optional(),
    admin_gate_verified_at: z.string().optional(),
    job_object_supported: z.boolean().optional(),
    filesystem_ready: z.boolean().optional(),
    filesystem_enforced: z.boolean().optional(),
    filesystem_reason: z.string().optional(),
    network_ready: z.boolean().optional(),
    network_enforced: z.boolean().optional(),
    network_reason: z.string().optional(),
    network_policies_enforced: z.array(SandboxNetworkPolicySchema).optional(),
    admin_gate_report_valid: z.boolean().optional(),
    acl_apply_verified: z.boolean().optional(),
  })
  .meta({ ref: "SandboxBackendStatus" })

export const SandboxNextActionSchema = z
  .object({
    kind: z.enum([
      "none",
      "enable_sandbox",
      "choose_native_backend",
      "install_helper",
      "update_helper",
      "install_setup",
      "run_admin_gate",
      "enable_acl_apply",
      "use_supported_network_policy",
      "inspect_status",
    ]),
    label: z.string(),
    command: z.string().optional(),
  })
  .meta({ ref: "SandboxNextAction" })

export const SandboxStatusSchema = z
  .object({
    platform: z.string(),
    helper_protocol_required: z.number(),
    config: z.object({
      enabled: z.boolean(),
      backend: SandboxBackendPreferenceSchema,
      failure_policy: SandboxFailurePolicySchema,
      report_only: z.boolean(),
      broker_idle_ttl_ms: z.number(),
      windows_acl_apply_mode: SandboxAclModeSchema,
    }),
    auto_backend: SandboxBackendNameSchema,
    preferred_backend: SandboxBackendNameSchema,
    backend_run_loop_enabled: z.boolean(),
    helper_path: z.string().nullable(),
    helper_override_used: z.boolean(),
    native_sandbox_ready: z.boolean(),
    ready_for_default_on: z.boolean(),
    default_on_enabled: z.boolean(),
    default_on_blockers: z.array(z.string()),
    admin_gate_report_valid: z.boolean(),
    acl_apply_verified: z.boolean(),
    windows_native: SandboxBackendStatusSchema,
    process: SandboxBackendStatusSchema,
    next_action: SandboxNextActionSchema,
  })
  .meta({ ref: "SandboxStatus" })

export type SandboxStatus = z.output<typeof SandboxStatusSchema>
export type SandboxNextAction = z.output<typeof SandboxNextActionSchema>

function sandboxConfig(config: Config.Info, platform = process.platform) {
  const sandbox = config.experimental?.sandbox
  return {
    enabled: sandbox?.enabled ?? true,
    backend: sandbox?.backend ?? "auto",
    failure_policy: sandbox?.failure_policy ?? (platform === "win32" ? "fallback" : "closed"),
    report_only: sandbox?.report_only ?? false,
    broker_idle_ttl_ms: sandbox?.broker_idle_ttl_ms ?? 300_000,
    windows_acl_apply_mode: sandbox?.windows_acl_apply_mode ?? "preflight",
  } satisfies SandboxConfig
}

function backendFromPreference(preference: SandboxBackendPreference, platform: NodeJS.Platform) {
  if (preference === "auto") return autoBackendName(platform)
  return preference
}

function missingWindowsStatus(reason: string, readiness: SandboxNativeReadiness): SandboxBackendStatus {
  return {
    name: "windows_native",
    available: false,
    readiness,
    reason,
    setup_required: false,
    filesystem_enforced: false,
    network_enforced: false,
    network_policies_enforced: [],
  } satisfies SandboxBackendStatus
}

function processStatus() {
  return {
    name: "process",
    available: true,
    helper: process.execPath,
    reason: "Process-level enforcement only; not an OS-native sandbox",
  } satisfies SandboxBackendStatus
}

function reportValue(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  return value as Record<string, unknown>
}

function reportStepPassed(value: unknown) {
  return reportValue(value)?.status === "passed"
}

function adminGateReportValid(windows: SandboxBackendStatus) {
  if (!windows.admin_gate_report_path) return false
  try {
    const report = reportValue(JSON.parse(readFileSync(windows.admin_gate_report_path, "utf8")))
    const helper = reportValue(report?.helper)
    const setupEvidence = reportValue(report?.setup_evidence)
    if (!report || !helper || !setupEvidence) return false
    if (report.schema_version !== 1) return false
    if (report.gate !== "windows_sandbox_admin_execution") return false
    if (report.status !== "passed") return false
    if (!Array.isArray(report.results) || report.results.length === 0) return false
    if (!report.results.every(reportStepPassed)) return false
    if (!reportStepPassed(setupEvidence.original_status)) return false
    if (!reportStepPassed(setupEvidence.install)) return false
    if (!reportStepPassed(setupEvidence.installed_status)) return false
    if (!reportStepPassed(setupEvidence.network_policy_none_proof)) return false
    if (!reportStepPassed(setupEvidence.restore)) return false
    if (!reportStepPassed(setupEvidence.restored_status)) return false
    if (setupEvidence.restored !== true) return false
    if (helper.helper_protocol_version !== windows.helper_protocol_version) return false
    if (helper.helper_version !== windows.helper_version) return false
    if (windows.helper_sha256 && helper.helper_sha256 !== windows.helper_sha256) return false
    return typeof report.generated_at === "string" && report.generated_at.length > 0
  } catch {
    return false
  }
}

function defaultOnBlockers(windows: SandboxBackendStatus, adminGateValid: boolean, aclApplyVerified: boolean) {
  return [
    !windows.helper_path ? "helper_missing" : undefined,
    windows.helper_protocol_version !== undefined &&
    windows.helper_protocol_version !== WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION
      ? "helper_version_mismatch"
      : undefined,
    !windows.job_object_supported ? "job_object_unavailable" : undefined,
    windows.setup_required || windows.setup_installed === false ? "wfp_setup_missing" : undefined,
    !adminGateValid ? "admin_gate_missing_or_stale" : undefined,
    !windows.filesystem_ready ? "filesystem_not_ready" : undefined,
    !aclApplyVerified
      ? windows.acl_apply_mode === "apply"
        ? "acl_apply_not_verified"
        : "acl_apply_not_enabled"
      : undefined,
    !windows.network_policies_enforced?.includes("none") ? "network_none_not_enforced" : undefined,
  ].filter((item): item is string => item !== undefined)
}

function actionFor(input: {
  sandbox: SandboxConfig
  preferred: SandboxBackendName
  platform: NodeJS.Platform
  helperPath?: string
  windows: SandboxBackendStatus
}) {
  if (!input.sandbox.enabled) {
    return {
      kind: "enable_sandbox",
      label: "Enable sandbox before checking native enforcement.",
    } satisfies SandboxNextAction
  }
  if (input.platform !== "win32") {
    return {
      kind: "none",
      label: "Windows native sandbox is not applicable on this platform.",
    } satisfies SandboxNextAction
  }
  if (input.preferred !== "windows_native") {
    return {
      kind: "choose_native_backend",
      label: "Choose Auto or Windows native to evaluate the native sandbox backend.",
    } satisfies SandboxNextAction
  }
  if (!input.helperPath || input.windows.readiness === "helper_missing") {
    return {
      kind: "install_helper",
      label: "Install a Windows build that includes openagt-sandbox-win.exe, then refresh status.",
      command: "openagt sandbox windows probe --json",
    } satisfies SandboxNextAction
  }
  if (input.windows.readiness === "helper_version_mismatch") {
    return {
      kind: "update_helper",
      label: "Update OpenAGt and the Windows sandbox helper so their protocol versions match.",
      command: "openagt sandbox windows probe --json",
    } satisfies SandboxNextAction
  }
  if (input.windows.readiness === "setup_required" || input.windows.setup_required) {
    return {
      kind: "install_setup",
      label: "Run Windows sandbox setup from an elevated terminal, then refresh status.",
      command: "openagt sandbox windows setup --install --json",
    } satisfies SandboxNextAction
  }
  if (input.windows.readiness === "admin_verification_required" || input.windows.admin_verification_required) {
    return {
      kind: "run_admin_gate",
      label: "Run the admin verification gate from an elevated repo terminal.",
      command: "bun run verify:windows-sandbox-admin",
    } satisfies SandboxNextAction
  }
  if (input.windows.readiness === "acl_apply_required" || !input.windows.filesystem_enforced) {
    return {
      kind: "enable_acl_apply",
      label: "Set Filesystem ACL mode to Apply after setup and admin verification are complete.",
    } satisfies SandboxNextAction
  }
  if (input.windows.readiness === "network_policy_unsupported") {
    return {
      kind: "use_supported_network_policy",
      label: "Use network_policy=none or full; loopback remains deferred.",
    } satisfies SandboxNextAction
  }
  if (input.windows.available && input.windows.readiness === "ready") {
    return {
      kind: "none",
      label: "Windows native sandbox is ready for newly started sandbox brokers.",
    } satisfies SandboxNextAction
  }
  return {
    kind: "inspect_status",
    label: input.windows.reason ?? "Inspect Windows sandbox setup status for the next required action.",
    command: "openagt sandbox windows setup --status --json",
  } satisfies SandboxNextAction
}

export function getSandboxStatus(input: {
  config: Config.Info
  platform?: NodeJS.Platform
  execPath?: string
  helperOverride?: string
  env?: NodeJS.ProcessEnv
  exists?: (candidate: string) => boolean
  probe?: (helper: string) => SandboxBackendStatus
}): SandboxStatus {
  const platform = input.platform ?? process.platform
  const sandbox = sandboxConfig(input.config, platform)
  const resolved = resolveWindowsHelperPath({
    platform,
    execPath: input.execPath,
    override: input.helperOverride ?? Flag.OPENAGT_SANDBOX_WINDOWS_HELPER,
    env: input.env,
    exists: input.exists,
  })
  const windows = resolved.path
    ? (input.probe ?? probeWindowsHelper)(resolved.path)
    : missingWindowsStatus(
        resolved.reason ?? "Windows native helper unavailable",
        platform === "win32" ? "helper_missing" : "backend_unavailable",
      )
  const preferred = backendFromPreference(sandbox.backend, platform)
  const adminGateValid = adminGateReportValid(windows)
  const aclApplyVerified = windows.acl_apply_mode === "apply" && windows.filesystem_enforced === true
  const nativeSandboxReady = windows.available && windows.readiness === "ready"
  const defaultOnBlockersList = platform === "win32" ? defaultOnBlockers(windows, adminGateValid, aclApplyVerified) : []
  const readyForDefaultOn = platform === "win32" && nativeSandboxReady && defaultOnBlockersList.length === 0
  const defaultOnEnabled =
    readyForDefaultOn &&
    sandbox.enabled &&
    sandbox.backend === "auto" &&
    sandbox.failure_policy === "closed" &&
    sandbox.windows_acl_apply_mode === "apply"
  const windowsWithDefaultOnEvidence = {
    ...windows,
    admin_gate_report_valid: adminGateValid,
    acl_apply_verified: aclApplyVerified,
  } satisfies SandboxBackendStatus

  return {
    platform,
    helper_protocol_required: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
    config: sandbox,
    auto_backend: autoBackendName(platform),
    preferred_backend: preferred,
    backend_run_loop_enabled: sandbox.enabled && preferred === "windows_native" && windows.available,
    helper_path: resolved.path ?? null,
    helper_override_used: resolved.source === "override",
    native_sandbox_ready: nativeSandboxReady,
    ready_for_default_on: readyForDefaultOn,
    default_on_enabled: defaultOnEnabled,
    default_on_blockers: defaultOnBlockersList,
    admin_gate_report_valid: adminGateValid,
    acl_apply_verified: aclApplyVerified,
    windows_native: windowsWithDefaultOnEvidence,
    process: processStatus(),
    next_action: actionFor({
      sandbox,
      preferred,
      platform,
      helperPath: resolved.path,
      windows,
    }),
  }
}
