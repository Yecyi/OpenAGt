// Runtime helpers for resolving and caching provider SDK instances.
// This file does not select default models, mutate provider catalogs, or handle auth discovery.

import { type Provider as SDK } from "ai"
import { Hash } from "@openagt/shared/util/hash"
import { Npm } from "../npm"
import { iife } from "@/util/iife"
import type { BundledProviderRegistry, BundledSDK } from "./bundled-provider-registry"
import type { CustomVarsLoader } from "./custom-loader-types"
import type { Info, Model } from "./provider"
import type { ProviderID } from "./schema"

export type ProviderSDKRuntimeState = {
  providers: Record<ProviderID, Info>
  sdk: Map<string, BundledSDK>
  varsLoaders: Record<string, CustomVarsLoader>
}

type ProviderSDKRuntimeLog = {
  info: (message: string, data?: Record<string, unknown>) => void
  time: (message: string, data?: Record<string, unknown>) => { [Symbol.dispose](): void }
}

type ResolveProviderSDKInput = {
  model: Model
  state: ProviderSDKRuntimeState
  envs: Record<string, string | undefined>
  bundledProviders: BundledProviderRegistry
  log: ProviderSDKRuntimeLog
  initError: (providerID: ProviderID, cause: unknown) => Error
}

function wrapSSE(res: Response, ms: number, ctl: AbortController) {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error("SSE read timed out")
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      if (part.done) {
        ctrl.close()
        return
      }

      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

export async function resolveProviderSDK(input: ResolveProviderSDKInput): Promise<SDK> {
  try {
    using _ = input.log.time("getSDK", {
      providerID: input.model.providerID,
    })
    const provider = input.state.providers[input.model.providerID]
    const options = { ...provider.options }

    if (input.model.providerID === "google-vertex" && !input.model.api.npm.includes("@ai-sdk/openai-compatible")) {
      delete options.fetch
    }

    if (input.model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
      options["includeUsage"] = true
    }

    const baseURL = iife(() => {
      let url =
        typeof options["baseURL"] === "string" && options["baseURL"] !== "" ? options["baseURL"] : input.model.api.url
      if (!url) return

      const loader = input.state.varsLoaders[input.model.providerID]
      if (loader) {
        const vars = loader(options)
        for (const [key, value] of Object.entries(vars)) {
          const field = "${" + key + "}"
          url = url.replaceAll(field, value)
        }
      }

      url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
        const val = input.envs[String(key)]
        return val ?? item
      })
      return url
    })

    if (baseURL !== undefined) options["baseURL"] = baseURL
    if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
    if (input.model.headers)
      options["headers"] = {
        ...options["headers"],
        ...input.model.headers,
      }

    const key = Hash.fast(
      JSON.stringify({
        providerID: input.model.providerID,
        npm: input.model.api.npm,
        options,
      }),
    )
    const existing = input.state.sdk.get(key)
    if (existing) return existing as SDK

    const customFetch = options["fetch"]
    const chunkTimeout = options["chunkTimeout"]
    delete options["chunkTimeout"]

    options["fetch"] = async (request: any, init?: BunFetchRequestInit) => {
      const fetchFn = customFetch ?? fetch
      const opts = init ?? {}
      const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
      const signals: AbortSignal[] = []

      if (opts.signal) signals.push(opts.signal)
      if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
      if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
        signals.push(AbortSignal.timeout(options["timeout"]))

      const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
      if (combined) opts.signal = combined

      // Strip openai itemId metadata following what codex does.
      if (input.model.api.npm === "@ai-sdk/openai" && opts.body && opts.method === "POST") {
        const body = JSON.parse(opts.body as string)
        const isAzure = input.model.providerID.includes("azure")
        const keepIds = isAzure && body.store === true
        if (!keepIds && Array.isArray(body.input)) {
          for (const item of body.input) {
            if ("id" in item) {
              delete item.id
            }
          }
          opts.body = JSON.stringify(body)
        }
      }

      const res = await fetchFn(request, {
        ...opts,
        // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
        timeout: false,
      })

      if (!chunkAbortCtl) return res
      return wrapSSE(res, chunkTimeout, chunkAbortCtl)
    }

    const bundledLoader = input.bundledProviders.loader(input.model.api.npm)
    if (bundledLoader) {
      input.log.info("using bundled provider", {
        providerID: input.model.providerID,
        pkg: input.model.api.npm,
      })
      const factory = await bundledLoader()
      const loaded = factory({
        name: input.model.providerID,
        ...options,
      })
      input.state.sdk.set(key, loaded)
      return loaded as SDK
    }

    let installedPath: string
    if (!input.model.api.npm.startsWith("file://")) {
      const item = await Npm.add(input.model.api.npm)
      if (!item.entrypoint) throw new Error(`Package ${input.model.api.npm} has no import entrypoint`)
      installedPath = item.entrypoint
    } else {
      input.log.info("loading local provider", { pkg: input.model.api.npm })
      installedPath = input.model.api.npm
    }

    const mod = await import(installedPath)

    const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
    const loaded = fn({
      name: input.model.providerID,
      ...options,
    })
    input.state.sdk.set(key, loaded)
    return loaded as SDK
  } catch (e) {
    throw input.initError(input.model.providerID, e)
  }
}
