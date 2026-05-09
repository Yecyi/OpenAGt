#!/usr/bin/env bun

import { $ } from "bun"
import { createHash } from "crypto"
import path from "path"

const root = process.cwd()
const pkg = await Bun.file(path.join(root, "packages", "openagt", "package.json")).json()

const arch = process.arch === "arm64" ? "arm64" : "x64"
const platformNames =
  process.platform === "win32" ? ["windows"] : process.platform === "darwin" ? ["macos", "darwin"] : ["linux"]
const candidates = platformNames.map((platform) =>
  path.join(
    root,
    "packages",
    "openagt",
    "dist",
    `openagt-${platform}-${arch}`,
    "release",
    "bin",
    process.platform === "win32" ? "openagt.exe" : "openagt",
  ),
)
const bin = (
  await Promise.all(candidates.map(async (candidate) => ((await Bun.file(candidate).exists()) ? candidate : undefined)))
).find((item) => item !== undefined)

if (!bin) {
  throw new Error(`Packaged binary not found. Tried:\n${candidates.join("\n")}`)
}

const help = await $`${bin} --help`.quiet()
if (help.exitCode !== 0 || !help.stdout.toString().toLowerCase().includes("openagt")) {
  throw new Error(`Packaged --help smoke failed for ${bin}`)
}

const releaseDir = path.dirname(path.dirname(bin))
const releaseVersionFile = path.join(releaseDir, "VERSION.txt")
const expectedVersion = (await Bun.file(releaseVersionFile).exists())
  ? (await Bun.file(releaseVersionFile).text()).trim()
  : pkg.version
const version = await $`${bin} --version`.quiet()
if (version.exitCode !== 0 || !version.stdout.toString().includes(expectedVersion)) {
  throw new Error(`Packaged --version smoke failed for ${bin}`)
}

const run = await $`${bin} run`.nothrow().quiet()
if (run.exitCode === 0 || !`${run.stdout}${run.stderr}`.toLowerCase().includes("message")) {
  throw new Error(`Packaged run argument smoke failed for ${bin}`)
}

if (process.platform === "win32") {
  const binDir = path.dirname(bin)
  const helper = path.join(binDir, "openagt-sandbox-win.exe")
  const helperSha = `${helper}.sha256`
  if (!(await Bun.file(helper).exists())) {
    throw new Error(`Packaged Windows sandbox helper not found: ${helper}`)
  }
  if (!(await Bun.file(helperSha).exists())) {
    throw new Error(`Packaged Windows sandbox helper checksum not found: ${helperSha}`)
  }
  const expectedHash = (await Bun.file(helperSha).text()).trim().split(/\s+/)[0]
  const actualHash = createHash("sha256").update(await Bun.file(helper).bytes()).digest("hex")
  if (expectedHash !== actualHash) {
    throw new Error(`Packaged Windows sandbox helper checksum mismatch for ${helper}`)
  }
  const helperProbe = await $`${helper} probe --json`.quiet()
  if (helperProbe.exitCode !== 0) {
    throw new Error(`Packaged Windows sandbox helper probe failed for ${helper}`)
  }
  const helperProbeJson = JSON.parse(helperProbe.stdout.toString()) as {
    helper_protocol_version?: number
    network_policies_enforced?: string[]
  }
  if (helperProbeJson.helper_protocol_version !== 1) {
    throw new Error(`Packaged Windows sandbox helper probe returned unexpected capabilities for ${helper}`)
  }
  const helperSetupStatus = await $`${helper} setup --status --json`.quiet()
  if (helperSetupStatus.exitCode !== 0) {
    throw new Error(`Packaged Windows sandbox helper setup status failed for ${helper}`)
  }
  const helperSetupStatusJson = JSON.parse(helperSetupStatus.stdout.toString()) as {
    mode?: string
    setup_required?: boolean
    network_policies_enforced?: string[]
  }
  if (helperSetupStatusJson.mode !== "status") {
    throw new Error(`Packaged Windows sandbox helper setup status returned unexpected state for ${helper}`)
  }
  const cliProbe = await $`${bin} sandbox windows probe --json`.quiet()
  if (cliProbe.exitCode !== 0 || !cliProbe.stdout.toString().includes("openagt-sandbox-win.exe")) {
    throw new Error(`Packaged Windows sandbox CLI probe failed for ${bin}`)
  }
  const cliSetupStatus = await $`${bin} sandbox windows setup --status --json`.quiet()
  if (
    cliSetupStatus.exitCode !== 0 ||
    !cliSetupStatus.stdout.toString().includes("openagt-sandbox-win.exe") ||
    !cliSetupStatus.stdout.toString().includes('"mode": "status"')
  ) {
    throw new Error(`Packaged Windows sandbox CLI setup status failed for ${bin}`)
  }
}

console.log(`Packaged binary smoke passed: ${bin}`)
