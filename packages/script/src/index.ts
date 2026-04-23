import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OPENAGT_CHANNEL: process.env["OPENAGT_CHANNEL"],
  OPENAGT_BUMP: process.env["OPENAGT_BUMP"],
  OPENAGT_VERSION: process.env["OPENAGT_VERSION"],
  OPENAGT_RELEASE: process.env["OPENAGT_RELEASE"],
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
  OPENCODE_RELEASE: process.env["OPENCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  const channel = env.OPENAGT_CHANNEL ?? env.OPENCODE_CHANNEL
  const bump = env.OPENAGT_BUMP ?? env.OPENCODE_BUMP
  const version = env.OPENAGT_VERSION ?? env.OPENCODE_VERSION
  if (channel) return channel
  if (bump) return "latest"
  if (version && !version.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  const explicitVersion = env.OPENAGT_VERSION ?? env.OPENCODE_VERSION
  const bump = (env.OPENAGT_BUMP ?? env.OPENCODE_BUMP)?.toLowerCase()
  if (explicitVersion) return explicitVersion
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const localVersion = await Bun.file(path.resolve(import.meta.dir, "../../../packages/openagt/package.json"))
    .json()
    .then((data) => {
      if (!data || typeof data !== "object" || !("version" in data) || typeof data.version !== "string") return "0.0.0"
      return data.version
    })
  const [major, minor, patch] = localVersion.split(".").map((x: string) => Number(x) || 0)
  if (bump === "major") return `${major + 1}.0.0`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!(env.OPENAGT_RELEASE ?? env.OPENCODE_RELEASE)
  },
  get team() {
    return team
  },
}
console.log(`openagt script`, JSON.stringify(Script, null, 2))
