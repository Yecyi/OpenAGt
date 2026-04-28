import { createFrameParser, encodeFrame } from "./protocol"
import { autoBackendName, detectBackends } from "./backends"
import { SANDBOX_PROTOCOL_VERSION, type SandboxBrokerRequestFrame } from "./types"

const backends = new Map(detectBackends().map((item) => [item.status.name, item]))
const running = new Map<string, { kill: () => void }>()
const preAbort = new Set<string>()

async function send(frame: unknown) {
  Bun.stdout.write(encodeFrame(frame as never))
}

function backendFor(frame: Extract<SandboxBrokerRequestFrame, { type: "exec.start" }>["request"]) {
  if (frame.backend_preference !== "auto") return backends.get(frame.backend_preference)
  const preferred = backends.get(autoBackendName())
  if (preferred?.status.available) return preferred
  return backends.get("process") ?? preferred
}

function policySummary(frame: Extract<SandboxBrokerRequestFrame, { type: "exec.start" }>["request"], reportOnly: boolean) {
  return {
    enforcement: frame.enforcement,
    backendPreference: frame.backend_preference,
    filesystemPolicy: frame.filesystem_policy,
    networkPolicy: frame.network_policy,
    allowedPaths: frame.allowed_paths,
    writablePaths: frame.writable_paths,
    reportOnly,
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
        policy_summary: policySummary(frame.request, true),
      },
    })
    return
  }
  const backend = backendFor(frame.request)
  if (!backend) {
    void send({
      type: "exec.error",
      protocol_version: SANDBOX_PROTOCOL_VERSION,
      request_id: frame.request.request_id,
      backend_used: "process",
      error: "Sandbox backend not found",
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
        result,
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
