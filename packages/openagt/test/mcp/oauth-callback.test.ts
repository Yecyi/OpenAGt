import { test, expect, describe, afterEach } from "bun:test"
import { createServer } from "node:http"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { parseRedirectUri } from "../../src/mcp/oauth-provider"

describe("parseRedirectUri", () => {
  test("returns defaults when no URI provided", () => {
    const result = parseRedirectUri()
    expect(result.port).toBe(19876)
    expect(result.path).toBe("/mcp/oauth/callback")
  })

  test("parses port and path from URI", () => {
    const result = parseRedirectUri("http://127.0.0.1:8080/oauth/callback")
    expect(result.port).toBe(8080)
    expect(result.path).toBe("/oauth/callback")
  })

  test("returns defaults for invalid URI", () => {
    const result = parseRedirectUri("not-a-valid-url")
    expect(result.port).toBe(19876)
    expect(result.path).toBe("/mcp/oauth/callback")
  })
})

describe("McpOAuthCallback.ensureRunning", () => {
  afterEach(async () => {
    await McpOAuthCallback.stop()
  })

  test("starts server with custom redirectUri port and path", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18000/custom/callback")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("escapes oauth error descriptions before rendering HTML", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18001/custom/callback")
    const pending = McpOAuthCallback.waitForCallback("state-xss")
    pending.catch(() => {})
    const response = await fetch(
      "http://127.0.0.1:18001/custom/callback?state=state-xss&error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    )
    const html = await response.text()
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    await expect(pending).rejects.toThrow("<script>alert(1)</script>")
  })

  test("rejects callbacks that do not match registered redirect path", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18003/custom/callback")
    McpOAuthCallback.registerRedirectUri("http://127.0.0.1:18003/other/callback")
    const pending = McpOAuthCallback.waitForCallback("state-path")
    pending.catch(() => {})
    const response = await fetch("http://127.0.0.1:18003/custom/callback?state=state-path&code=abc")
    const html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toContain("redirect_uri mismatch")
    await McpOAuthCallback.stop()
    await expect(pending).rejects.toThrow("OAuth callback server stopped")
  })

  test("fails fast when callback port is already in use", async () => {
    const server = createServer((_req, res) => res.end("occupied"))
    await new Promise<void>((resolve) => server.listen(18004, "127.0.0.1", resolve))
    try {
      await expect(McpOAuthCallback.ensureRunning("http://127.0.0.1:18004/custom/callback")).rejects.toThrow(
        "already in use",
      )
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
