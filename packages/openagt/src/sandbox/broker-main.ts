import { createFrameParser, encodeFrame } from "./protocol"
import { detectBackends } from "./backends"
import { SANDBOX_PROTOCOL_VERSION, type SandboxBrokerRequestFrame } from "./types"

const backends = new Map(detectBackends().map((item) => [item.status.name, item]))
const running = new Map<string, { kill: () => void }>()

async function send(frame: unknown) {
  Bun.stdout.write(encodeFrame(frame as never))
}

function backendFor(frame: Extract<SandboxBrokerRequestFrame, { type: "exec.start" }>["request"]) {
  if (frame.backend_preference !== "auto") return backends.get(frame.backend_preference)
  if (process.platform === "darwin") return backends.get("seatbelt")
  if (process.platform === "win32") return backends.get("windows_native")
  if (process.platform === "linux") return backends.get("landlock")
  return backends.get("process")
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
    running.get(frame.request_id)?.kill()
    running.delete(frame.request_id)
    return
  }
  if (frame.type !== "exec.start") return
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
