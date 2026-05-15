// Stable cache keys for provider SDK/model instances. The keys include
// account-scoped auth fingerprints without storing raw credentials.
import { Hash } from "@openagt/shared/util/hash"
import type { Auth } from "../auth"

function stableCacheString(value: unknown): string {
  if (value === undefined) return '"[undefined]"'
  if (value === null) return "null"
  if (typeof value === "function") return JSON.stringify(`[function:${value.name || "anonymous"}]`)
  if (typeof value === "bigint") return JSON.stringify(value.toString())
  if (typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableCacheString).join(",")}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableCacheString((value as Record<string, unknown>)[key])}`)
    .join(",")}}`
}

const secretHash = (value: string | undefined) => (value ? Hash.fast(value).slice(0, 16) : "")

export function authCacheScope(auth: Auth.Info | undefined) {
  if (!auth) return { type: "none" }
  if (auth.type === "api")
    return {
      type: "api",
      keyHash: secretHash(auth.key),
      metadata: auth.metadata ?? {},
    }
  if (auth.type === "oauth")
    return {
      type: "oauth",
      accountId: auth.accountId ?? "",
      enterpriseUrl: auth.enterpriseUrl ?? "",
      accessHash: secretHash(auth.access),
      refreshHash: secretHash(auth.refresh),
    }
  return {
    type: "wellknown",
    keyHash: secretHash(auth.key),
    tokenHash: secretHash(auth.token),
  }
}

export function providerModelCacheKey(input: {
  providerID: string
  modelID: string
  options: Record<string, unknown>
  auth: Auth.Info | undefined
}) {
  return `${input.providerID}/${input.modelID}:${Hash.fast(
    stableCacheString({
      auth: authCacheScope(input.auth),
      options: input.options,
    }),
  )}`
}

export function providerSDKCacheKey(input: { providerID: string; npm: string; options: Record<string, unknown> }) {
  return Hash.fast(stableCacheString(input))
}
