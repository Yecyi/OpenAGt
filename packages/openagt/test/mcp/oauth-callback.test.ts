import { test, expect, describe, afterEach } from "bun:test"
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

  test("escapes provider error descriptions in callback page", async () => {
    const redirect = "http://127.0.0.1:18001/custom/callback"
    await McpOAuthCallback.ensureRunning(redirect)
    const callback = McpOAuthCallback.waitForCallback("state-xss").catch((error) => error)
    const response = await fetch(`${redirect}?state=state-xss&error=access_denied&error_description=%3Cimg%20src=x%20onerror=alert(1)%3E`)
    const html = await response.text()
    const error = await callback
    expect(error).toBeInstanceOf(Error)
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
  })
})
