#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"

const root = process.cwd()
const pkg = await Bun.file(path.join(root, "packages", "openagt", "package.json")).json()

const arch = process.arch === "arm64" ? "arm64" : "x64"
const platformNames =
  process.platform === "win32"
    ? ["windows"]
    : process.platform === "darwin"
      ? ["macos", "darwin"]
      : ["linux"]
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
const bin = (await Promise.all(candidates.map(async (candidate) => ((await Bun.file(candidate).exists()) ? candidate : undefined)))).find(
  (item) => item !== undefined,
)

if (!bin) {
  throw new Error(`Packaged binary not found. Tried:\n${candidates.join("\n")}`)
}

const help = await $`${bin} --help`.quiet()
if (help.exitCode !== 0 || !help.stdout.toString().toLowerCase().includes("openagt")) {
  throw new Error(`Packaged --help smoke failed for ${bin}`)
}

const version = await $`${bin} --version`.quiet()
if (version.exitCode !== 0 || !version.stdout.toString().includes(pkg.version)) {
  throw new Error(`Packaged --version smoke failed for ${bin}`)
}

const run = await $`${bin} run`.nothrow().quiet()
if (run.exitCode === 0 || !`${run.stdout}${run.stderr}`.toLowerCase().includes("message")) {
  throw new Error(`Packaged run argument smoke failed for ${bin}`)
}

console.log(`Packaged binary smoke passed: ${bin}`)
