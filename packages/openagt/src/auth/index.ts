import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { AppFileSystem } from "@openagt/shared/filesystem"

export const OAUTH_DUMMY_KEY = "openagt-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")
const legacyFile = path.join(Global.Path.legacyData, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Number,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export const Info = Object.assign(_Info, { zod: zod(_Info) })
export type Info = Schema.Schema.Type<typeof _Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = () =>
      Effect.gen(function* () {
      if (process.env.OPENAGT_AUTH_CONTENT || process.env.OPENCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENAGT_AUTH_CONTENT || process.env.OPENCODE_AUTH_CONTENT || "{}")
        } catch (err) {}
      }

      const data = (yield* fsys
        .readJson(file)
        .pipe(
          Effect.catch(() => fsys.readJson(legacyFile)),
          Effect.orElseSucceed(() => ({})),
        )) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
      })

    const get = (providerID: string) => Effect.map(all(), (data) => data[providerID])

    const set = (key: string, info: Info) =>
      Effect.gen(function* () {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        if (norm !== key) delete data[key]
        delete data[norm + "/"]
        yield* fsys
          .writeJson(file, { ...data, [norm]: info }, 0o600)
          .pipe(Effect.mapError(fail("Failed to write auth data")))
      })

    const remove = (key: string) =>
      Effect.gen(function* () {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        delete data[key]
        delete data[norm]
        yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
      })

    return Service.of({ get, all, set, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Auth from "."
