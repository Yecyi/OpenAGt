#!/usr/bin/env bun

import { $ } from "bun"

const pkg = await Bun.file("packages/openagt/package.json").json()
process.env.OPENAGT_VERSION ||= pkg.version
process.env.OPENAGT_CHANNEL ||= "latest"
process.env.OPENAGT_RELEASE ||= "1"

console.log("=== OpenAGt stable release prep ===\n")

await $`bun run release:verify`
await $`bun run release:notes --version ${process.env.OPENAGT_VERSION}`
await $`bun run --cwd packages/openagt script/build.ts --single --archive --no-upload --skip-install`

console.log("\nStable release prep completed for the current platform.")
