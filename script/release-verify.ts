#!/usr/bin/env bun

import { $ } from "bun"

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
  "test/agent/coordinator-personal.test.ts",
  "test/security/exec-policy.test.ts",
  "test/security/shell-security.test.ts",
]

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
