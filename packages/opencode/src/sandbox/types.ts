export const SANDBOX_PROTOCOL_VERSION = 1

export type SandboxBackendName = "process" | "seatbelt" | "windows_native" | "landlock"
export type SandboxEnforcement = "required" | "advisory"
export type SandboxFailurePolicy = "closed" | "confirm_downgrade" | "fallback"
export type SandboxBackendPreference = SandboxBackendName | "auto"
export type SandboxFilesystemPolicy = "read_only" | "workspace_write" | "explicit_paths"
export type SandboxNetworkPolicy = "none" | "loopback" | "full"
export type SandboxEnvPolicy = "sanitize"
export type SandboxTerminationReason = "exit" | "timeout" | "abort" | "backend_error" | "policy_denied"

export type SandboxBackendStatus = {
  name: SandboxBackendName
  available: boolean
  helper?: string
  reason?: string
}

export type SandboxPolicySummary = {
  enforcement: SandboxEnforcement
  backendPreference: SandboxBackendPreference
  filesystemPolicy: SandboxFilesystemPolicy
  networkPolicy: SandboxNetworkPolicy
  allowedPaths: string[]
  writablePaths: string[]
  reportOnly: boolean
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
  policy_summary: SandboxPolicySummary
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
}
