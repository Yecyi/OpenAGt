export const SANDBOX_PROTOCOL_VERSION = 2

export type SandboxBackendName = "process" | "seatbelt" | "windows_native" | "landlock"
export type SandboxEnforcement = "required" | "advisory"
export type SandboxFailurePolicy = "closed" | "confirm_downgrade" | "fallback"
export type SandboxBackendPreference = SandboxBackendName | "auto"
export type SandboxFilesystemPolicy = "read_only" | "workspace_write" | "explicit_paths"
export type SandboxNetworkPolicy = "none" | "loopback" | "full"
export type SandboxEnvPolicy = "sanitize"
export type SandboxWindowsAclApplyMode = "preflight" | "dry_run" | "apply"
export type SandboxTerminationReason = "exit" | "timeout" | "abort" | "backend_error" | "policy_denied"
export type SandboxNativeReadiness =
  | "ready"
  | "helper_missing"
  | "helper_version_mismatch"
  | "setup_required"
  | "admin_verification_required"
  | "acl_apply_required"
  | "network_policy_unsupported"
  | "backend_unavailable"

export type SandboxBackendStatus = {
  name: SandboxBackendName
  available: boolean
  helper?: string
  helper_path?: string
  helper_version?: string
  helper_sha256?: string
  readiness?: SandboxNativeReadiness
  reason?: string
  setup_required?: boolean
  setup_reason?: string
  setup_installed?: boolean
  setup_version?: string
  helper_protocol_version?: number
  acl_apply_mode?: "preflight" | "dry_run" | "apply"
  admin_verification_required?: boolean
  admin_gate_report_path?: string
  admin_gate_verified_at?: string
  job_object_supported?: boolean
  filesystem_ready?: boolean
  filesystem_enforced?: boolean
  filesystem_reason?: string
  network_ready?: boolean
  network_enforced?: boolean
  network_reason?: string
  network_policies_enforced?: SandboxNetworkPolicy[]
}

// Renamed from SandboxPolicySummary to make explicit that this is *advisory*
// metadata only — the process backend does not enforce filesystem or network
// policy at the OS level. The `enforced` flag tells consumers whether any
// real OS-level isolation took place.
export type SandboxPolicyAdvisory = {
  enforcement: SandboxEnforcement
  backendPreference: SandboxBackendPreference
  filesystemPolicy: SandboxFilesystemPolicy
  networkPolicy: SandboxNetworkPolicy
  allowedPaths: string[]
  writablePaths: string[]
  reportOnly: boolean
  enforced: boolean
  filesystemEnforced?: boolean
  networkEnforced?: boolean
  windowsSandboxMode?: "restricted_token" | "elevated_user"
  downgradeReason?: string
}

export type SandboxExecRequest = {
  request_id: string
  command: string
  shell_family: "powershell" | "posix" | "cmd"
  shell: string
  cwd: string
  timeout_ms: number
  description: string
  env: Record<string, string>
  env_policy: SandboxEnvPolicy
  enforcement: SandboxEnforcement
  backend_preference: SandboxBackendPreference
  failure_policy: SandboxFailurePolicy
  filesystem_policy: SandboxFilesystemPolicy
  allowed_paths: string[]
  writable_paths: string[]
  network_policy: SandboxNetworkPolicy
}

export type SandboxExecResult = {
  request_id: string
  exit_code: number | null
  termination_reason: SandboxTerminationReason
  backend_used: SandboxBackendName
  stdout_tail: string
  stderr_tail: string
  output_path?: string
  policy_advisory: SandboxPolicyAdvisory
}

export type SandboxHelloFrame = {
  type: "broker.hello"
  protocol_version: typeof SANDBOX_PROTOCOL_VERSION
  pid: number
}

export type SandboxCapabilitiesFrame = {
  type: "broker.capabilities"
  protocol_version: typeof SANDBOX_PROTOCOL_VERSION
  backends: SandboxBackendStatus[]
}

export type SandboxExecStartFrame = {
  type: "exec.start"
  protocol_version: typeof SANDBOX_PROTOCOL_VERSION
  request: SandboxExecRequest
}

export type SandboxExecAbortFrame = {
  type: "exec.abort"
  protocol_version: typeof SANDBOX_PROTOCOL_VERSION
  request_id: string
}

export type SandboxExecStdoutFrame = {
  type: "exec.stdout"
  protocol_version: typeof SANDBOX_PROTOCOL_VERSION
  request_id: string
  chunk: string
}

export type SandboxExecStderrFrame = {
  type: "exec.stderr"
  protocol_version: typeof SANDBOX_PROTOCOL_VERSION
  request_id: string
  chunk: string
}

export type SandboxExecExitFrame = {
  type: "exec.exit"
  protocol_version: typeof SANDBOX_PROTOCOL_VERSION
  result: SandboxExecResult
}

export type SandboxExecErrorFrame = {
  type: "exec.error"
  protocol_version: typeof SANDBOX_PROTOCOL_VERSION
  request_id: string
  backend_used: SandboxBackendName
  error: string
}

export type SandboxBrokerRequestFrame = SandboxExecStartFrame | SandboxExecAbortFrame

export type SandboxBrokerFrame =
  | SandboxHelloFrame
  | SandboxCapabilitiesFrame
  | SandboxExecStdoutFrame
  | SandboxExecStderrFrame
  | SandboxExecExitFrame
  | SandboxExecErrorFrame

export type SandboxConfig = {
  enabled: boolean
  backend: SandboxBackendPreference
  failure_policy: SandboxFailurePolicy
  report_only: boolean
  broker_idle_ttl_ms: number
  windows_acl_apply_mode: SandboxWindowsAclApplyMode
}
