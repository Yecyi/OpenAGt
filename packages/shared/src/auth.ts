export const DEFAULT_SERVER_USERNAME = "openagt"
export const LEGACY_SERVER_USERNAMES = ["opencode", "openAG"] as const

export function serverUsernames(configured?: string) {
  return Array.from(new Set([configured ?? DEFAULT_SERVER_USERNAME, DEFAULT_SERVER_USERNAME, ...LEGACY_SERVER_USERNAMES]))
}
