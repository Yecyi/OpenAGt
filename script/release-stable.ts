#!/usr/bin/env bun

import { $ } from "bun"
import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"

const pkg = await Bun.file("packages/openagt/package.json").json()
process.env.OPENAGT_VERSION ||= pkg.version
process.env.OPENAGT_CHANNEL ||= "latest"
process.env.OPENAGT_RELEASE ||= "1"
const root = process.cwd()
const releaseDist = path.join(root, "packages", "openagt", "dist")

console.log("=== OpenAGt stable release prep ===\n")

await $`bun run release:verify`
await $`bun run release:notes --version ${process.env.OPENAGT_VERSION}`
await $`bun run --cwd packages/openagt script/build.ts --single --archive --no-upload --skip-install`

await mkdir(releaseDist, { recursive: true })
await copyFile(
  path.join(root, "dist", `release-notes-v${process.env.OPENAGT_VERSION}.md`),
  path.join(releaseDist, "release-notes.md"),
)

if (process.platform === "win32") {
  const wix = await $`wix --version`.quiet().nothrow()
  if (wix.exitCode === 0) {
    await $`powershell -NoProfile -ExecutionPolicy Bypass -File packages/openagt/script/build-windows-installer.ps1 -Version ${process.env.OPENAGT_VERSION}`
    await $`powershell -NoProfile -Command "Remove-Item .\\packages\\openagt\\dist\\openagt-windows-x64.zip -Force -ErrorAction SilentlyContinue; Compress-Archive -Path .\\packages\\openagt\\dist\\openagt-windows-x64\\release\\* -DestinationPath .\\packages\\openagt\\dist\\openagt-windows-x64.zip -Force"`
  } else {
    console.log("Skipping Windows MSI: WiX v4 CLI (wix) is not available.")
  }
}

await $`bun run script/release-checksums.ts --dir packages/openagt/dist --output packages/openagt/dist/SHA256SUMS.txt`
await $`bun run script/release-sbom.ts --output packages/openagt/dist/sbom.spdx.json`

console.log("\nStable release prep completed for the current platform.")
