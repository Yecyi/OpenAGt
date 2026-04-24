import { describe, expect, test } from "bun:test"
import { DEFAULT_SERVER_USERNAME, isAllowedServerUsername } from "@openagt/shared/auth"

describe("server auth usernames", () => {
  test("allows legacy aliases only for the default username", () => {
    expect(isAllowedServerUsername("openagt")).toBe(true)
    expect(isAllowedServerUsername("opencode")).toBe(true)
    expect(isAllowedServerUsername("openAG")).toBe(true)
  })

  test("requires exact match for custom usernames", () => {
    expect(isAllowedServerUsername("admin", "admin")).toBe(true)
    expect(isAllowedServerUsername("opencode", "admin")).toBe(false)
    expect(isAllowedServerUsername(DEFAULT_SERVER_USERNAME, "admin")).toBe(false)
  })
})
