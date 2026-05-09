import { createFrameParser, encodeFrame } from "./protocol"
import { autoBackendName, detectBackends } from "./backends"
import { selectBackend } from "./backend-selection"
import { SANDBOX_PROTOCOL_VERSION, type SandboxBrokerRequestFrame } from "./types"

const backends = new Map(detectBackends().map((item) => [item.status.name, item]))
const running = new Map<string, { kill: () => void }>()
const preAbort = new Set<string>()

// Honest disclosure: only the process backend is implemented today, and it
// applies no OS-level filesystem/network isolation. Per-request enforcement
// fields are advisory only — see SandboxPolicyAdvisory.enforced.
const nativeBackendAvailable = Array.from(backends.values()).some(
  (item) => item.status.name !== "process" && item.status.available,
)
if (!nativeBackendAvailable) {
  Bun.stderr.write(
    "[SECURITY] sandbox broker: no native isolation backend available — process backend has no FS/network enforcement. policy_advisory.enforced=false on all results.\n",
  )
}

async function send(frame: unknown) {
  Bun.stdout.write(encodeFrame(frame as never))
}

function policyAdvisory(frame: Extract<SandboxBrokerRequestFrame, { type: "exec.start" }>["request"], reportOnly: boolean) {
  return {
    enforcement: frame.enforcement,
    backendPreference: frame.backend_preference,
    filesystemPolicy: frame.filesystem_policy,
    networkPolicy: frame.network_policy,
    allowedPaths: frame.allowed_paths,
    writablePaths: frame.writable_paths,
    reportOnly,
    enforced: false,
    filesystemEnforced: false,
    networkEnforced: false,
  }
}

function rememberPreAbort(requestID: string) {
  preAbort.add(requestID)
  const timer = setTimeout(() => preAbort.delete(requestID), 30_000) as ReturnType<typeof setTimeout> & {
    unref?: () => void
  }
  timer.unref?.()
}

await send({
  type: "broker.hello",
  protocol_version: SANDBOX_PROTOCOL_VERSION,
  pid: process.pid,
})

await send({
  type: "broker.capabilities",
  protocol_version: SANDBOX_PROTOCOL_VERSION,
  backends: Array.from(backends.values(), (item) => item.status),
})

const parser = createFrameParser((frame) => {
  if (frame.type === "exec.abort") {
    const handle = running.get(frame.request_id)
    if (handle) {
      handle.kill()
      running.delete(frame.request_id)
      return
    }
    rememberPreAbort(frame.request_id)
    return
  }
  if (frame.type !== "exec.start") return
  if (preAbort.delete(frame.request.request_id)) {
    void send({
      type: "exec.exit",
      protocol_version: SANDBOX_PROTOCOL_VERSION,
      result: {
        request_id: frame.request.request_id,
        exit_code: null,
        termination_reason: "abort",
        backend_used: "process",
        stdout_tail: "",
        stderr_tail: "",
        policy_advisory: policyAdvisory(frame.request, true),
      },
    })
    return
  }
  const selection = selectBackend({
    backends,
    backendPreference: frame.request.backend_preference,
    failurePolicy: frame.request.failure_policy,
    autoBackendName: autoBackendName(),
    networkPolicy: frame.request.network_policy,
  })
  if (selection.type === "deny") {
    void send({
      type: "exec.error",
      protocol_version: SANDBOX_PROTOCOL_VERSION,
      request_id: frame.request.request_id,
      backend_used: selection.backendUsed,
      error: selection.reason,
    })
    return
  }
  const backend = backends.get(selection.backend.name)
  if (!backend) {
    void send({
      type: "exec.error",
      protocol_version: SANDBOX_PROTOCOL_VERSION,
      request_id: frame.request.request_id,
      backend_used: selection.backend.name,
      error: `Sandbox backend not found: ${selection.backend.name}`,
    })
    return
  }
  const handle = backend.run({
    request: frame.request,
    onStdout: (chunk) =>
      void send({
        type: "exec.stdout",
        protocol_version: SANDBOX_PROTOCOL_VERSION,
        request_id: frame.request.request_id,
        chunk,
      }),
    onStderr: (chunk) =>
      void send({
        type: "exec.stderr",
        protocol_version: SANDBOX_PROTOCOL_VERSION,
        request_id: frame.request.request_id,
        chunk,
      }),
    onExit: (result) => {
      running.delete(frame.request.request_id)
      void send({
        type: "exec.exit",
        protocol_version: SANDBOX_PROTOCOL_VERSION,
        result: {
          ...result,
          policy_advisory: {
            ...result.policy_advisory,
            ...(selection.downgradeReason ? { downgradeReason: selection.downgradeReason } : {}),
          },
        },
      })
    },
    onError: (error, backendUsed) => {
      running.delete(frame.request.request_id)
      void send({
        type: "exec.error",
        protocol_version: SANDBOX_PROTOCOL_VERSION,
        request_id: frame.request.request_id,
        backend_used: backendUsed,
        error,
      })
    },
  })
  running.set(frame.request.request_id, handle)
})

const reader = Bun.stdin.stream().getReader()
while (true) {
  const next = await reader.read()
  if (next.done || !next.value) break
  parser(next.value)
}
