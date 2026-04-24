import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@openagt/console-resource"
import { cookie, docs, localeFromRequest, tag } from "~/lib/language"

const FORWARDED_HEADERS = [
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "if-none-match",
  "if-modified-since",
  "range",
] as const

async function handler(evt: APIEvent) {
  const req = evt.request.clone()
  const url = new URL(req.url)
  const locale = localeFromRequest(req)
  const host = Resource.App.stage === "production" ? "docs.opencode.ai" : "docs.dev.opencode.ai"
  const targetUrl = `https://${host}${docs(locale, url.pathname)}${url.search}`

  const headers = new Headers()
  for (const key of FORWARDED_HEADERS) {
    const value = req.headers.get(key)
    if (value) headers.set(key, value)
  }
  headers.set("accept-language", tag(locale))

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: req.body,
  })
  const next = new Response(response.body, response)
  next.headers.append("set-cookie", cookie(locale))
  return next
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const OPTIONS = handler
export const PATCH = handler
