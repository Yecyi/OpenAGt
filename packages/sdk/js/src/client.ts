export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import type { GlobalEvent as GeneratedGlobalEvent } from "./gen/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export class OpenagtClient extends OpencodeClient {}
export { type Config as OpencodeClientConfig, OpencodeClient }
export { type Config as OpenagtClientConfig }
export type Event = Exclude<GeneratedGlobalEvent["payload"], { type: "sync" }>

function pick(value: string | null, fallback?: string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (value === encodeURIComponent(fallback)) return fallback
  return value
}

function rewrite(request: Request, directory?: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return request

  const value = pick(
    request.headers.get("x-openagt-directory") ?? request.headers.get("x-opencode-directory"),
    directory,
  )
  if (!value) return request

  const url = new URL(request.url)
  if (!url.searchParams.has("directory")) {
    url.searchParams.set("directory", value)
  }

  const next = new Request(url, request)
  next.headers.delete("x-openagt-directory")
  next.headers.delete("x-opencode-directory")
  return next
}

export function createOpencodeClient(config?: Config & { directory?: string }) {
  const effectiveConfig = config ? { ...config } : {}
  if (!effectiveConfig.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    effectiveConfig.fetch = customFetch
  }

  if (effectiveConfig.directory) {
    effectiveConfig.headers = {
      ...effectiveConfig.headers,
      "x-openagt-directory": encodeURIComponent(effectiveConfig.directory),
      "x-opencode-directory": encodeURIComponent(effectiveConfig.directory),
    }
  }

  const client = createClient(effectiveConfig)
  client.interceptors.request.use((request) => rewrite(request, effectiveConfig?.directory))
  return new OpencodeClient({ client })
}

export function createOpenagtClient(config?: Config & { directory?: string }) {
  const effectiveConfig = config ? { ...config } : {}
  if (!effectiveConfig.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    effectiveConfig.fetch = customFetch
  }

  if (effectiveConfig.directory) {
    effectiveConfig.headers = {
      ...effectiveConfig.headers,
      "x-openagt-directory": encodeURIComponent(effectiveConfig.directory),
      "x-opencode-directory": encodeURIComponent(effectiveConfig.directory),
    }
  }

  const client = createClient(effectiveConfig)
  client.interceptors.request.use((request) => rewrite(request, effectiveConfig?.directory))
  return new OpenagtClient({ client })
}
