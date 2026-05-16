#!/usr/bin/env bun

import { $ } from "bun"

process.env.OPENAGT_ALLOW_MODELS_SNAPSHOT_FALLBACK ||= "1"

const root = process.cwd()

async function step(name: string, run: () => Promise<unknown>) {
  console.log(`\n=== ${name} ===`)
  await run()
}

await step(
  "Prompt affect audit including opt-in prompts",
  () => $`bun run check:prompt-affect -- --include-opt-in --fail-on-block`,
)
await step("Tool import audit", () => $`bun run check:tool-imports -- --fail-on-block`)
await step("Release verification", () => $`bun run release:verify`)
await step("Runtime foundation verification", () => $`bun run verify:runtime-foundation`)
await step("SDK build and typecheck", async () => {
  await $`bun run script/build.ts`.cwd("packages/sdk/js")
  await $`bun typecheck`.cwd("packages/sdk/js")
})
await step("Packaged binary smoke when local release assets exist", async () => {
  const pkg = await Bun.file("packages/openagt/package.json").json()
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
  const bin = `${root}/packages/openagt/dist/${pkg.name}-${platform}-${arch}/release/bin/${
    process.platform === "win32" ? "openagt.exe" : "openagt"
  }`
  if (!(await Bun.file(bin).exists())) {
    console.log(`Skipping release smoke; packaged binary is not present at ${bin}`)
    return
  }
  await $`bun run release:smoke`
})

console.log("\nv1.22 GA verification passed.")
