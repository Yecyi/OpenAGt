export const DEFAULT_SERVER_USERNAME = "openagt"
export const LEGACY_SERVER_USERNAMES = ["opencode", "openAG"] as const

export function isAllowedServerUsername(username: string, expected = DEFAULT_SERVER_USERNAME) {
  return username === expected || LEGACY_SERVER_USERNAMES.includes(username as (typeof LEGACY_SERVER_USERNAMES)[number])
}
