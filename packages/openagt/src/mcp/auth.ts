import path from "path"
import z from "zod"
import { Global } from "../global"
import { Effect, Layer, Context } from "effect"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { Log } from "@/util"
import * as crypto from "crypto"

const log = Log.create({ service: "mcp-auth" })

export const Tokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
})
export type Tokens = z.infer<typeof Tokens>

export const ClientInfo = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientIdIssuedAt: z.number().optional(),
  clientSecretExpiresAt: z.number().optional(),
})
export type ClientInfo = z.infer<typeof ClientInfo>

export const Entry = z.object({
  tokens: Tokens.optional(),
  clientInfo: ClientInfo.optional(),
  codeVerifier: z.string().optional(),
  oauthState: z.string().optional(),
  serverUrl: z.string().optional(),
})
export type Entry = z.infer<typeof Entry>

const filepath = path.join(Global.Path.data, "mcp-auth.json")

const ENCRYPTION_KEY_ENV = "OPENCODE_MCP_KEY"
const ENCRYPTION_ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env[ENCRYPTION_KEY_ENV]
  if (!keyHex) return null
  const key = Buffer.from(keyHex, "hex")
  if (key.length !== 32) {
    log.warn("OPENCODE_MCP_KEY must be 32 bytes (64 hex chars), encryption disabled", {
      keyLength: key.length,
    })
    return null
  }
  return key
}

function encryptTokens(tokens: Tokens): string | null {
  const key = getEncryptionKey()
  if (!key) return null
  try {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
    const plaintext = Buffer.from(JSON.stringify(tokens), "utf8")
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const authTag = cipher.getAuthTag()
    return Buffer.concat([iv, authTag, encrypted]).toString("base64")
  } catch (err) {
    log.warn("failed to encrypt tokens, storing plaintext", { error: String(err) })
    return null
  }
}

function decryptTokens(encrypted: string): Tokens | null {
  const key = getEncryptionKey()
  if (!key) return null
  try {
    const raw = Buffer.from(encrypted, "base64")
    if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) return null
    const iv = raw.subarray(0, IV_LENGTH)
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const data = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
    return JSON.parse(decrypted.toString("utf8")) as Tokens
  } catch (err) {
    log.warn("failed to decrypt tokens", { error: String(err) })
    return null
  }
}

type StoredEntry = Entry & { _encryptedTokens?: string }

function decryptEntryTokens(entry: StoredEntry): Entry {
  if (entry.tokens) return entry as Entry
  if (entry._encryptedTokens) {
    const tokens = decryptTokens(entry._encryptedTokens)
    if (tokens) {
      return { ...entry, tokens } as Entry
    }
  }
  return entry as Entry
}

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, Entry>>
  readonly get: (mcpName: string) => Effect.Effect<Entry | undefined>
  readonly getForUrl: (mcpName: string, serverUrl: string) => Effect.Effect<Entry | undefined>
  readonly set: (mcpName: string, entry: Entry, serverUrl?: string) => Effect.Effect<void>
  readonly remove: (mcpName: string) => Effect.Effect<void>
  readonly updateTokens: (mcpName: string, tokens: Tokens, serverUrl?: string) => Effect.Effect<void>
  readonly updateClientInfo: (mcpName: string, clientInfo: ClientInfo, serverUrl?: string) => Effect.Effect<void>
  readonly updateCodeVerifier: (mcpName: string, codeVerifier: string) => Effect.Effect<void>
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>
  readonly updateOAuthState: (mcpName: string, oauthState: string) => Effect.Effect<void>
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>
  readonly isTokenExpired: (mcpName: string) => Effect.Effect<boolean | null>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpAuth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const all = Effect.fn("McpAuth.all")(function* () {
      return yield* fs.readJson(filepath).pipe(
        Effect.map((data) => {
          const raw = data as Record<string, StoredEntry>
          const result: Record<string, Entry> = {}
          for (const [name, entry] of Object.entries(raw)) {
            result[name] = decryptEntryTokens(entry)
          }
          return result
        }),
        Effect.catch(() => Effect.succeed({} as Record<string, Entry>)),
      )
    })

    const get = Effect.fn("McpAuth.get")(function* (mcpName: string) {
      const data = yield* all()
      return data[mcpName]
    })

    const getForUrl = Effect.fn("McpAuth.getForUrl")(function* (mcpName: string, serverUrl: string) {
      const entry = yield* get(mcpName)
      if (!entry) return undefined
      if (!entry.serverUrl) return undefined
      if (entry.serverUrl !== serverUrl) return undefined
      return entry
    })

    const set = Effect.fn("McpAuth.set")(function* (mcpName: string, entry: Entry, serverUrl?: string) {
      const data = yield* all()
      if (serverUrl) entry.serverUrl = serverUrl
      const storedEntry: StoredEntry = { ...entry }
      if (entry.tokens) {
        const encrypted = encryptTokens(entry.tokens)
        if (encrypted) {
          delete storedEntry.tokens
          storedEntry._encryptedTokens = encrypted
        }
      }
      yield* fs.writeJson(filepath, { ...data, [mcpName]: storedEntry }, 0o600).pipe(Effect.orDie)
    })

    const remove = Effect.fn("McpAuth.remove")(function* (mcpName: string) {
      const data = yield* all()
      delete data[mcpName]
      yield* fs.writeJson(filepath, data, 0o600).pipe(Effect.orDie)
    })

    const updateField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string, value: NonNullable<Entry[K]>, serverUrl?: string) {
        const entry = (yield* get(mcpName)) ?? {}
        entry[field] = value
        yield* set(mcpName, entry, serverUrl)
      })

    const clearField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string) {
        const entry = yield* get(mcpName)
        if (entry) {
          delete entry[field]
          yield* set(mcpName, entry)
        }
      })

    const updateTokens = updateField("tokens", "updateTokens")
    const updateClientInfo = updateField("clientInfo", "updateClientInfo")
    const updateCodeVerifier = updateField("codeVerifier", "updateCodeVerifier")
    const updateOAuthState = updateField("oauthState", "updateOAuthState")
    const clearCodeVerifier = clearField("codeVerifier", "clearCodeVerifier")
    const clearOAuthState = clearField("oauthState", "clearOAuthState")

    const getOAuthState = Effect.fn("McpAuth.getOAuthState")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      return entry?.oauthState
    })

    const isTokenExpired = Effect.fn("McpAuth.isTokenExpired")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      if (!entry?.tokens) return null
      if (!entry.tokens.expiresAt) return false
      return entry.tokens.expiresAt < Date.now() / 1000
    })

    return Service.of({
      all,
      get,
      getForUrl,
      set,
      remove,
      updateTokens,
      updateClientInfo,
      updateCodeVerifier,
      clearCodeVerifier,
      updateOAuthState,
      getOAuthState,
      clearOAuthState,
      isTokenExpired,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as McpAuth from "./auth"
