#!/usr/bin/env bun

import { $ } from "bun"

const steps = [
  {
    title: "Build SDK",
    command: $`bun run --cwd packages/sdk/js script/build.ts`,
  },
  {
    title: "Build config schemas",
    command: $`bun run script/schema.ts`.cwd("packages/openagt"),
  },
  {
    title: "Typecheck packages/openagt",
    command: $`bun typecheck`.cwd("packages/openagt"),
  },
  {
    title: "Typecheck packages/sdk/js",
    command: $`bun typecheck`.cwd("packages/sdk/js"),
  },
  {
    title: "Focused runtime tests",
    command:
      $`bun test test/session/task-runtime-agentic.test.ts test/agent/coordinator-personal.test.ts test/security/exec-policy.test.ts test/security/shell-security.test.ts test/tool/bash.test.ts`.cwd(
        "packages/openagt",
      ),
  },
]

for (const step of steps) {
  console.log(`\n=== ${step.title} ===\n`)
  await step.command
}
