import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ConfigApi } from "../../src/server/routes/instance/httpapi/config"
import { Config } from "../../src/config"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  await Promise.all(
    ["config.json", "opencode.json", "opencode.jsonc"].map((file) =>
      fs.rm(path.join(Global.Path.config, file), { force: true }),
    ),
  )
})

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

  test("serves parseable effective config snapshots through the Hono route", async () => {
    await using tmp = await tmpdir()
    const response = await Server.Default().app.request("/config/effective", {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(Config.EffectiveConfigSnapshot.parse(await response.json()).field_sources).toEqual({})
  })

  test("accepts safe global config patches through the Hono route", async () => {
    await using tmp = await tmpdir()
    const response = await Server.Default().app.request("/config/global", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({
        permission: { bash: "ask" },
      }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).permission?.bash).toBe("ask")
  })

  test("rejects unsafe global config patches through the Hono route", async () => {
    await using tmp = await tmpdir()
    const response = await Server.Default().app.request("/config/global", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({
        model: "provider/model",
      }),
    })

    expect(response.status).toBe(400)
  })
})
