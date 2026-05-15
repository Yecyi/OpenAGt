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
  "test/agent/coordinator-intent.test.ts",
  "test/agent/coordinator-runner.test.ts",
  "test/agent/coordinator-v121-pipeline.test.ts",
  "test/agent/expert-additive.test.ts",
  "test/agent/mpacr-governance.test.ts",
  "test/agent/mpacr-schema.test.ts",
  "test/agent/review-verdict.test.ts",
  "test/session/compaction.test.ts",
  "test/agent/coordinator-personal.test.ts",
  "test/server/security-middleware.test.ts",
  "test/security/decision-pipeline.test.ts",
  "test/security/exec-policy.test.ts",
  "test/security/shell-security.test.ts",
  "test/sandbox/broker.test.ts",
  "test/sandbox/policy.test.ts",
  "test/shell/runner.test.ts",
  "test/tool/webfetch.test.ts",
  "test/tool/lsp.test.ts",
  "test/util/process.test.ts",
  "test/util/path-canonical.test.ts",
  "test/util/sanitize-output.test.ts",
]

async function assertGeneratedFileCurrent(label: string, current: string, generated: string) {
  const currentText = (await Bun.file(current).text()).replace(/\r\n?/g, "\n")
  const generatedText = (await Bun.file(generated).text()).replace(/\r\n?/g, "\n")
  if (currentText === generatedText) return
  throw new Error(`${label} is out of date. Run bun run script/schema.ts in packages/openagt and commit the result.`)
}

async function verifyConfigSchemas() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openagt-schema-"))
  try {
    const configFile = path.join(dir, "config.json")
    const tuiFile = path.join(dir, "tui.json")
    await $`bun run script/schema.ts ${configFile} ${tuiFile}`.cwd("packages/openagt")
    await assertGeneratedFileCurrent(
      "packages/openagt/schema/config.json",
      "packages/openagt/schema/config.json",
      configFile,
    )
    await assertGeneratedFileCurrent("packages/openagt/schema/tui.json", "packages/openagt/schema/tui.json", tuiFile)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function cargoCandidates() {
  return [
    process.env.CARGO,
    "cargo",
    process.platform === "win32"
      ? path.join(os.homedir(), ".cargo", "bin", "cargo.exe")
      : path.join(os.homedir(), ".cargo", "bin", "cargo"),
  ].filter((item): item is string => Boolean(item))
}

function findCargo() {
  for (const candidate of cargoCandidates()) {
    const check = Bun.spawnSync({
      cmd: [candidate, "--version"],
      stdout: "ignore",
      stderr: "ignore",
    })
    if (check.exitCode === 0) return candidate
  }
}

async function runCargo(args: string[]) {
  const cargo = findCargo()
  if (!cargo) {
    if (process.platform === "win32") throw new Error("Rust cargo is required to verify the Windows sandbox helper")
    console.warn("Skipping Windows sandbox helper cargo verification because cargo is not installed")
    return
  }
  const proc = Bun.spawn({
    cmd: [cargo, ...args],
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(`cargo ${args.join(" ")} failed with ${exitCode}`)
}

async function verifyWindowsSandboxHelper() {
  const manifest = path.join("packages", "openagt-sandbox-win", "Cargo.toml")
  if (!(await Bun.file(manifest).exists())) return
  await runCargo(["check", "--manifest-path", manifest])
  await runCargo(["test", "--manifest-path", manifest])
}

function object(value: unknown, label: string) {
  if (value && typeof value === "object") return value as Record<string, unknown>
  throw new Error(`${label} is missing or not an object`)
}

function stringArray(value: unknown, label: string) {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value
  throw new Error(`${label} is missing or not a string array`)
}

async function verifyWindowsSandboxDefaultOnContract() {
  const root = object(await Bun.file("packages/sdk/openapi.json").json(), "OpenAPI root")
  const sandboxStatus = object(
    object(object(root.components, "OpenAPI components").schemas, "OpenAPI schemas").SandboxStatus,
    "SandboxStatus schema",
  )
  const sandboxStatusProperties = object(sandboxStatus.properties, "SandboxStatus properties")
  const required = stringArray(sandboxStatus.required, "SandboxStatus required")
  for (const field of [
    "native_sandbox_ready",
    "ready_for_default_on",
    "default_on_enabled",
    "default_on_blockers",
    "admin_gate_report_valid",
    "acl_apply_verified",
  ]) {
    if (!(field in sandboxStatusProperties)) throw new Error(`SandboxStatus is missing ${field}`)
    if (!required.includes(field)) throw new Error(`SandboxStatus does not require ${field}`)
  }

  const statusSource = await Bun.file("packages/openagt/src/sandbox/status.ts").text()
  if (!statusSource.includes("Process-level enforcement only; not an OS-native sandbox")) {
    throw new Error("Sandbox process backend wording must remain advisory-only")
  }

  const docs = await Bun.file("docs/hardening-status.md").text()
  if (!docs.includes("Default-on Windows OS-native sandbox enforcement remains blocked")) {
    throw new Error("hardening-status must state that Windows native sandbox default-on remains blocked")
  }
  if (!docs.includes("network_policy=loopback` remains deferred")) {
    throw new Error("hardening-status must state that network_policy=loopback remains deferred")
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
    title: "Check prompt affect",
    run: () => $`bun run check:prompt-affect -- --fail-on-block`,
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
    run: () => $`bun test ${runtimeTests} --timeout 30000`.cwd("packages/openagt"),
  },
  {
    title: "Verify Windows sandbox default-on contract",
    run: verifyWindowsSandboxDefaultOnContract,
  },
  {
    title: "Verify Windows sandbox helper",
    run: verifyWindowsSandboxHelper,
  },
]

for (const step of steps) {
  console.log(`\n=== ${step.title} ===\n`)
  await step.run()
}
