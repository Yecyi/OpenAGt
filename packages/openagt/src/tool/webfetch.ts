import z from "zod"
import { Effect } from "effect"
import { lookup } from "node:dns/promises"
import net from "node:net"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const MAX_REDIRECTS = 5

const parameters = z.object({
  url: z.string().describe("The URL to fetch content from"),
  format: z
    .enum(["text", "markdown", "html"])
    .default("markdown")
    .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
  timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: {
              url: params.url,
              format: params.format,
              timeout: params.timeout,
            },
          })

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

          // Build Accept header based on requested format with q parameters for fallbacks
          let acceptHeader = "*/*"
          switch (params.format) {
            case "markdown":
              acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
              break
            case "text":
              acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
              break
            case "html":
              acceptHeader =
                "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
              break
            default:
              acceptHeader =
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          }
          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          }

          const response = yield* safeFetch(params.url, headers, timeout).pipe(
            Effect.flatMap((response) => {
              if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
                return safeFetch(params.url, { ...headers, "User-Agent": "opencode" }, timeout)
              }
              return Effect.succeed(response)
            }),
          )

          // Check content length
          const contentLength = response.headers.get("content-length")
          if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const arrayBuffer = yield* Effect.promise(() => response.arrayBuffer())
          if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const contentType = response.headers.get("content-type") || ""
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const title = `${params.url} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(arrayBuffer).toString("base64")
            return {
              title,
              output: "Image fetched successfully",
              metadata: {},
              attachments: [
                {
                  type: "file" as const,
                  mime,
                  url: `data:${mime};base64,${base64Content}`,
                },
              ],
            }
          }

          const content = new TextDecoder().decode(arrayBuffer)

          // Handle content based on requested format and actual content type
          switch (params.format) {
            case "markdown":
              if (contentType.includes("text/html")) {
                const markdown = convertHTMLToMarkdown(content)
                return {
                  output: markdown,
                  title,
                  metadata: {},
                }
              }
              return { output: content, title, metadata: {} }

            case "text":
              if (contentType.includes("text/html")) {
                const text = yield* Effect.promise(() => extractTextFromHTML(content))
                return { output: text, title, metadata: {} }
              }
              return { output: content, title, metadata: {} }

            case "html":
              return { output: content, title, metadata: {} }

            default:
              return { output: content, title, metadata: {} }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function safeFetch(url: string, headers: Record<string, string>, timeout: number) {
  return Effect.tryPromise({
    try: async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        let current = new URL(url)
        for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
          await assertFetchTarget(current, redirect > 0)
          const response = await fetch(current, {
            headers,
            redirect: "manual",
            signal: controller.signal,
          })
          if (!isRedirect(response.status)) {
            if (response.status < 200 || response.status >= 300) {
              throw new Error(`Request failed with status ${response.status}`)
            }
            return response
          }
          const location = response.headers.get("location")
          if (!location) throw new Error(`Redirect ${response.status} missing Location header`)
          current = new URL(location, current)
        }
        throw new Error(`Too many redirects (>${MAX_REDIRECTS})`)
      } finally {
        clearTimeout(timer)
      }
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

function isRedirect(status: number) {
  return status >= 300 && status < 400
}

async function assertFetchTarget(url: URL, redirected: boolean) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Redirect target must use http or https")
  if (process.env.OPENAGT_ALLOW_PRIVATE_WEBFETCH === "1" || process.env.OPENCODE_ALLOW_PRIVATE_WEBFETCH === "1") return
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host === "metadata.google.internal" || host.endsWith(".metadata.google.internal")) {
    throw new Error("WebFetch blocked private metadata host")
  }
  if (isBlockedAddress(host)) {
    throw new Error("WebFetch blocked private or local address")
  }
  const addresses = await lookup(host, { all: true }).catch(() => [])
  for (const address of addresses) {
    if (isBlockedAddress(address.address)) throw new Error("WebFetch blocked private or local address")
  }
}

function isBlockedAddress(address: string) {
  const ipVersion = net.isIP(address)
  if (ipVersion === 4) return isBlockedIPv4(address)
  if (ipVersion === 6) return isBlockedIPv6(address)
  return address === "localhost" || address.endsWith(".localhost")
}

function isBlockedIPv4(address: string) {
  const parts = address.split(".").map(Number)
  const first = parts[0] ?? 0
  const second = parts[1] ?? 0
  if (first === 0 || first === 10 || first === 127 || first >= 224) return true
  if (first === 100 && second >= 64 && second <= 127) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  if (first === 198 && (second === 18 || second === 19)) return true
  return address === "169.254.169.254"
}

function isBlockedIPv6(address: string) {
  const lower = address.toLowerCase()
  if (lower === "::1" || lower === "::") return true
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true
  if (!lower.startsWith("::ffff:")) return false
  return isBlockedIPv4(lower.slice("::ffff:".length))
}

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
