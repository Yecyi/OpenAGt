export const OPENCODE_RUN_ID = "OPENCODE_RUN_ID"
export const OPENCODE_PROCESS_ROLE = "OPENCODE_PROCESS_ROLE"

export type OpencodeProcessRole = "main" | "worker" | "broker"

export function ensureRunID() {
  return (process.env[OPENCODE_RUN_ID] ??= crypto.randomUUID())
}

export function ensureProcessRole(fallback: OpencodeProcessRole) {
  return (process.env[OPENCODE_PROCESS_ROLE] ??= fallback)
}

export function ensureProcessMetadata(fallback: OpencodeProcessRole) {
  return {
    runID: ensureRunID(),
    processRole: ensureProcessRole(fallback),
  }
}

export function sanitizedProcessEnv(overrides?: Record<string, string>) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      if (entry[1] === undefined) return false
      if (entry[0] === "OPENAGT_AUTH_CONTENT" || entry[0] === "OPENCODE_AUTH_CONTENT") return false
      return true
    }),
  )
  return overrides ? Object.assign(env, overrides) : env
}
