export const DEFAULT_SERVER_USERNAME = "openagt"
export const LEGACY_SERVER_USERNAMES = ["opencode", "openAG"] as const

export function isAllowedServerUsername(username: string, expected = DEFAULT_SERVER_USERNAME) {
  if (username === expected) return true
  if (expected !== DEFAULT_SERVER_USERNAME) return false
  return LEGACY_SERVER_USERNAMES.includes(username as (typeof LEGACY_SERVER_USERNAMES)[number])
}

export function serverUsernames(configured?: string) {
  return Array.from(
    new Set([configured ?? DEFAULT_SERVER_USERNAME, DEFAULT_SERVER_USERNAME, ...LEGACY_SERVER_USERNAMES]),
  )
}
