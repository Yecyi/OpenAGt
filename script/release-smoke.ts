#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"

const root = process.cwd()
const pkg = await Bun.file(path.join(root, "packages", "openagt", "package.json")).json()
const bin =
  process.platform === "win32"
    ? path.join(root, "packages", "openagt", "dist", "openagt-windows-x64", "release", "bin", "openagt.exe")
    : path.join(root, "packages", "openagt", "dist", `openagt-${process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`, "release", "bin", "openagt")

if (!(await Bun.file(bin).exists())) {
  throw new Error(`Packaged binary not found: ${bin}`)
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
