import { SANDBOX_PROTOCOL_VERSION, type SandboxBrokerFrame, type SandboxBrokerRequestFrame } from "./types"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function bytes(input: SandboxBrokerFrame | SandboxBrokerRequestFrame) {
  return textEncoder.encode(JSON.stringify(input))
}

export function encodeFrame(input: SandboxBrokerFrame | SandboxBrokerRequestFrame) {
  const body = bytes(input)
  const header = textEncoder.encode(body.byteLength.toString(16).padStart(8, "0"))
  const frame = new Uint8Array(header.byteLength + body.byteLength)
  frame.set(header, 0)
  frame.set(body, header.byteLength)
  return frame
}

export function createFrameParser(
  onFrame: (frame: SandboxBrokerFrame | SandboxBrokerRequestFrame) => void,
  onError?: (error: Error) => void,
) {
  let buffer = new Uint8Array(0)
  return (chunk: Uint8Array) => {
    const next = new Uint8Array(buffer.length + chunk.length)
    next.set(buffer, 0)
    next.set(chunk, buffer.length)
    buffer = next
    while (buffer.length >= 8) {
      const size = Number.parseInt(textDecoder.decode(buffer.subarray(0, 8)), 16)
      if (!Number.isFinite(size) || size < 0) {
        onError?.(new Error("Invalid sandbox frame header"))
        buffer = new Uint8Array(0)
        return
      }
      if (buffer.length < 8 + size) return
      const payload = buffer.subarray(8, 8 + size)
      buffer = buffer.subarray(8 + size)
      try {
        const frame = JSON.parse(textDecoder.decode(payload)) as SandboxBrokerFrame | SandboxBrokerRequestFrame
        if (frame.protocol_version !== SANDBOX_PROTOCOL_VERSION) {
          onError?.(new Error("Unsupported sandbox protocol version"))
          continue
        }
        onFrame(frame)
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }
}
