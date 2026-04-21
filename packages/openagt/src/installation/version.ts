declare global {
  const OPENAGT_VERSION: string
  const OPENAGT_CHANNEL: string
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

export const InstallationVersion =
  typeof OPENAGT_VERSION === "string"
    ? OPENAGT_VERSION
    : typeof OPENCODE_VERSION === "string"
      ? OPENCODE_VERSION
      : "local"
export const InstallationChannel =
  typeof OPENAGT_CHANNEL === "string"
    ? OPENAGT_CHANNEL
    : typeof OPENCODE_CHANNEL === "string"
      ? OPENCODE_CHANNEL
      : "local"
export const InstallationLocal = InstallationChannel === "local"
