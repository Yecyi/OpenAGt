const ALLOWED_PROXY_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "range",
  "user-agent",
])

export function proxyRequestHeaders(input: Headers) {
  const headers = new Headers()
  for (const [key, value] of input) {
    if (ALLOWED_PROXY_HEADERS.has(key.toLowerCase())) headers.set(key, value)
  }
  return headers
}
