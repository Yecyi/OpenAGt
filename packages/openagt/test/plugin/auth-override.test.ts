import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Cause, Effect } from "effect"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider"
import { ProviderID } from "../../src/provider/schema"
import { Auth } from "../../src/auth"

describe("plugin.auth-override", () => {
  test("user plugin overrides built-in github-copilot auth", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default {",
            '  id: "demo.custom-copilot-auth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "github-copilot",',
            "      methods: [",
            '        { type: "api", label: "Test Override Auth" },',
            "      ],",
            "      loader: async () => ({ access: 'test-token' }),",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await using plain = await tmpdir()

    const methods = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        return Effect.runPromise(
          ProviderAuth.Service.use((svc) => svc.methods()).pipe(Effect.provide(ProviderAuth.defaultLayer)),
        )
      },
    })

    const plainMethods = await Instance.provide({
      directory: plain.path,
      fn: async () => {
        return Effect.runPromise(
          ProviderAuth.Service.use((svc) => svc.methods()).pipe(Effect.provide(ProviderAuth.defaultLayer)),
        )
      },
    })

    const copilot = methods[ProviderID.make("github-copilot")]
    expect(copilot).toBeDefined()
    expect(copilot.length).toBe(1)
    expect(copilot[0].label).toBe("Test Override Auth")
    expect(plainMethods[ProviderID.make("github-copilot")][0].label).not.toBe("Test Override Auth")
  }, 30000) // Increased timeout for plugin installation

  test("oauth callback cleanup runs when callback throws", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "throwing-oauth.ts"),
          [
            "export default {",
            '  id: "demo.throwing-oauth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "throw-oauth",',
            "      methods: [",
            "        {",
            '          type: "oauth",',
            '          label: "Throwing OAuth",',
            "          authorize: async () => ({",
            '            url: "https://example.com/auth",',
            '            instructions: "test",',
            '            method: "auto",',
            "            callback: async () => { throw new Error('callback exploded') },",
            "          }),",
            "        },",
            "      ],",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providerID = ProviderID.make("throw-oauth")
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProviderAuth.Service
            yield* svc.authorize({ providerID, method: 0 })
            const first = yield* Effect.exit(svc.callback({ providerID, method: 0 }))
            expect(first._tag).toBe("Failure")
            if (first._tag === "Failure") expect(Cause.pretty(first.cause)).toContain("callback exploded")
            const second = yield* Effect.exit(svc.callback({ providerID, method: 0 }))
            expect(second._tag).toBe("Failure")
            if (second._tag === "Failure") expect(Cause.pretty(second.cause)).toContain("ProviderAuthOauthMissing")
          }).pipe(Effect.provide(ProviderAuth.defaultLayer)),
        )
      },
    })
  }, 30000)

  test("oauth refresh hook updates expired stored auth", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "refresh-oauth.ts"),
          [
            "export default {",
            '  id: "demo.refresh-oauth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "refresh-oauth",',
            "      methods: [],",
            "      refresh: async (auth) => ({",
            '        type: "success",',
            '        refresh: `${auth.refresh}-new`,',
            '        access: "new-access",',
            "        expires: 123456789,",
            '        accountId: auth.accountId || "existing-account",',
            "      }),",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providerID = ProviderID.make("refresh-oauth")
        await Effect.runPromise(
          Effect.gen(function* () {
            const auth = yield* Auth.Service
            const svc = yield* ProviderAuth.Service
            yield* auth.set(providerID, {
              type: "oauth",
              refresh: "old-refresh",
              access: "old-access",
              expires: 0,
              accountId: "old-account",
            })
            expect(yield* svc.refresh(providerID)).toBe(true)
            expect(yield* auth.get(providerID)).toMatchObject({
              type: "oauth",
              refresh: "old-refresh-new",
              access: "new-access",
              expires: 123456789,
              accountId: "old-account",
            })
          }).pipe(Effect.provide(Auth.defaultLayer), Effect.provide(ProviderAuth.defaultLayer)),
        )
      },
    })
  }, 30000)
})

const file = path.join(import.meta.dir, "../../src/plugin/index.ts")

describe("plugin.config-hook-error-isolation", () => {
  test("config hooks are individually error-isolated in the layer factory", async () => {
    const src = await Bun.file(file).text()

    // Each hook's config call is wrapped in Effect.tryPromise with error logging + Effect.ignore
    expect(src).toContain("plugin config hook failed")

    const pattern =
      /for\s*\(const hook of hooks\)\s*\{[\s\S]*?Effect\.tryPromise[\s\S]*?\.config\?\.\([\s\S]*?plugin config hook failed[\s\S]*?Effect\.ignore/
    expect(pattern.test(src)).toBe(true)
  })
})
