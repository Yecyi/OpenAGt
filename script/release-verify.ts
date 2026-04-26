#!/usr/bin/env bun

import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const typecheckPackages = [
  "packages/openagt",
  "packages/app",
  "packages/shared",
  "packages/ui",
  "packages/plugin",
  "packages/enterprise",
  "packages/console/app",
  "packages/console/core",
  "packages/function",
  "packages/sdk/js",
]

const runtimeTests = [
  "test/session/task-runtime-agentic.test.ts",
  "test/session/compaction.test.ts",
  "test/agent/coordinator-personal.test.ts",
  "test/server/security-middleware.test.ts",
  "test/security/exec-policy.test.ts",
  "test/security/shell-security.test.ts",
  "test/tool/webfetch.test.ts",
  "test/util/process.test.ts",
  "test/util/sanitize-output.test.ts",
]

async function assertGeneratedFileCurrent(label: string, current: string, generated: string) {
  const currentText = await Bun.file(current).text()
  const generatedText = await Bun.file(generated).text()
  if (currentText === generatedText) return
  throw new Error(`${label} is out of date. Run bun run script/schema.ts in packages/openagt and commit the result.`)
}

async function verifyConfigSchemas() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openagt-schema-"))
  try {
    const configFile = path.join(dir, "config.json")
    const tuiFile = path.join(dir, "tui.json")
    await $`bun run script/schema.ts ${configFile} ${tuiFile}`.cwd("packages/openagt")
    await assertGeneratedFileCurrent("packages/openagt/schema/config.json", "packages/openagt/schema/config.json", configFile)
    await assertGeneratedFileCurrent("packages/openagt/schema/tui.json", "packages/openagt/schema/tui.json", tuiFile)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const steps = [
  {
    title: "Build SDK",
    run: () => $`bun run --cwd packages/sdk/js script/build.ts`,
  },
  {
    title: "Check source integrity",
    run: () => $`bun run check:integrity`,
  },
  {
    title: "Verify config schemas",
    run: verifyConfigSchemas,
  },
  {
    title: "Check audit policy",
    run: () => $`bun run check:audit-policy`,
  },
  {
    title: "Audit dependencies",
    run: () => $`bun audit --json`,
  },
  {
    title: "Lint",
    run: () => $`bun run lint`,
  },
  {
    title: "Typecheck packages",
    run: () => Promise.all(typecheckPackages.map((pkg) => $`bun typecheck`.cwd(pkg))),
  },
  {
    title: "Focused runtime and security tests",
    run: () => $`bun test ${runtimeTests}`.cwd("packages/openagt"),
  },
]

for (const step of steps) {
  console.log(`\n=== ${step.title} ===\n`)
  await step.run()
}
