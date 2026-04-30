import { describe, expect, test } from "bun:test"
import { ConfigApi } from "../../src/server/routes/instance/httpapi/config"

describe("ConfigApi", () => {
  test("keeps experimental HttpApi config routes aligned with advanced settings routes", () => {
    const endpoints = ConfigApi.groups.config.endpoints

    expect(endpoints.providers?.method).toBe("GET")
    expect(endpoints.providers?.path).toBe("/config/providers")
    expect(endpoints.effective?.method).toBe("GET")
    expect(endpoints.effective?.path).toBe("/config/effective")
    expect(endpoints.updateGlobal?.method).toBe("PATCH")
    expect(endpoints.updateGlobal?.path).toBe("/config/global")
  })
})
