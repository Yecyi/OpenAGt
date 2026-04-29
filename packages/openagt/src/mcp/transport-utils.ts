// Closes MCP transports when the SDK object exposes a close method.
// This file does not create transports, manage OAuth state, or decide retry behavior.

import { Effect } from "effect"

type ClosableTransport = { close: () => void | Promise<void> }

function isClosableTransport(transport: unknown): transport is ClosableTransport {
  return !!transport && typeof transport === "object" && "close" in transport && typeof transport.close === "function"
}

export function closeTransportIfSupported(transport: unknown) {
  if (!isClosableTransport(transport)) return Effect.void
  return Effect.tryPromise(async () => {
    await transport.close()
  }).pipe(Effect.ignore)
}
