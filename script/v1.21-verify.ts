#!/usr/bin/env bun

// v1.21 release-verification gate. Mirrors the shape of script/v1.20-verify.ts
// but routes through the v1.21-specific test surface (MPACR, 3LMA, calibration,
// prompt-templates, expert registry) and adds explicit assertions for the
// hazard-register rows that v1.21 closes via runtime wiring (H5, H8, H9, H13):
//   - `db status` integrity check exits 0 (H5)
//   - the four v1.21 migration directories are present (H8/H9 advisory locks,
//     H13 prompt outcomes, H5 schema-version audit, calibration records)

import { mkdir, stat } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const pkg = await Bun.file(path.join(root, "packages", "openagt", "package.json")).json()
const artifactDir = path.join(root, ".artifacts", `v${String(pkg.version).split(".").slice(0, 2).join(".")}`)

type Step = {
  name: string
  cwd: string
  cmd: string[]
}

type StepResult = Step & {
  status: "passed" | "failed"
  exitCode: number
  durationMs: number
  stdout: string
  stderr: string
}

function trimOutput(value: string) {
  if (value.length <= 12_000) return value
  return `${value.slice(0, 12_000)}\n...[truncated ${value.length - 12_000} chars]`
}

async function run(step: Step): Promise<StepResult> {
  const started = Date.now()
  console.log(`\n=== ${step.name} ===`)
  console.log(`${step.cwd}> ${step.cmd.join(" ")}`)
  const proc = Bun.spawn(step.cmd, {
    cwd: step.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (stdout.trim()) console.log(stdout)
  if (stderr.trim()) console.error(stderr)
  return {
    ...step,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    durationMs: Date.now() - started,
    stdout: trimOutput(stdout),
    stderr: trimOutput(stderr),
  }
}

// v1.21 hazard-register migrations. Their presence on disk is a necessary
// precondition for the hazards they close to be considered live; runtime tests
// then exercise the wired behaviour.
const REQUIRED_MIGRATIONS = [
  "20260428000000_calibration_records",
  "20260428120000_schema_version_table",
  "20260428180000_advisory_locks",
  "20260430000000_prompt_outcomes",
]

async function verifyMigrations(): Promise<StepResult> {
  const started = Date.now()
  const cmd = ["check-migrations"]
  const cwd = path.join(root, "packages", "openagt", "migration")
  console.log(`\n=== v1.21 migration directory presence ===`)
  console.log(`${cwd}> ${cmd.join(" ")}`)
  const missing: string[] = []
  for (const name of REQUIRED_MIGRATIONS) {
    const present = await stat(path.join(cwd, name))
      .then(() => true)
      .catch(() => false)
    if (!present) missing.push(name)
  }
  const status = missing.length === 0 ? "passed" : "failed"
  const stdout = missing.length === 0 ? `All ${REQUIRED_MIGRATIONS.length} v1.21 migrations present.\n` : ""
  const stderr =
    missing.length === 0
      ? ""
      : `Missing v1.21 migration directories under packages/openagt/migration:\n${missing
          .map((name) => `  - ${name}`)
          .join("\n")}\n`
  if (stdout.trim()) console.log(stdout)
  if (stderr.trim()) console.error(stderr)
  return {
    name: "v1.21 migration directory presence",
    cwd,
    cmd,
    status,
    exitCode: missing.length === 0 ? 0 : 1,
    durationMs: Date.now() - started,
    stdout: trimOutput(stdout),
    stderr: trimOutput(stderr),
  }
}

const focusedTests = [
  // Carry-over v1.20 security/runtime gates so v1.21 doesn't regress them.
  "test/server/security-middleware.test.ts",
  "test/tool/webfetch.test.ts",
  "test/util/sanitize-output.test.ts",
  "test/util/process.test.ts",
  "test/session/compaction.test.ts",
  "test/session/task-runtime-agentic.test.ts",
  // v1.21 streams.
  "test/agent/coordinator-intent.test.ts",
  "test/agent/coordinator-runner.test.ts",
  "test/agent/coordinator-v121-pipeline.test.ts",
  "test/agent/coordinator-personal.test.ts",
  "test/agent/expert-additive.test.ts",
  "test/agent/calibration.test.ts",
  "test/agent/mpacr-governance.test.ts",
  "test/agent/mpacr-partial-failure.test.ts",
  "test/agent/mpacr-schema.test.ts",
  "test/agent/mpacr-shape.test.ts",
  "test/agent/mpacr-validation.test.ts",
  "test/agent/prompt-templates-snapshot.test.ts",
  "test/agent/review-verdict.test.ts",
  "test/personal/three-layer.test.ts",
  "test/personal/three-layer-enrichment.test.ts",
]

const steps: Step[] = [
  {
    name: "OpenAGt typecheck",
    cwd: path.join(root, "packages", "openagt"),
    cmd: ["bun", "typecheck"],
  },
  {
    name: "SDK typecheck",
    cwd: path.join(root, "packages", "sdk", "js"),
    cmd: ["bun", "typecheck"],
  },
  {
    name: "v1.21 focused stream tests",
    cwd: path.join(root, "packages", "openagt"),
    cmd: ["bun", "test", ...focusedTests, "--timeout", "30000"],
  },
  {
    name: "db status integrity smoke (H5)",
    cwd: path.join(root, "packages", "openagt"),
    cmd: ["bun", "test", "test/cli/smoke.test.ts", "--test-name-pattern", "status runs integrity"],
  },
  {
    name: "OpenAGt full tests",
    cwd: path.join(root, "packages", "openagt"),
    cmd: ["bun", "test", "--timeout", "30000"],
  },
  {
    name: "Release verification",
    cwd: root,
    cmd: ["bun", "run", "release:verify"],
  },
  {
    name: "Stable release build",
    cwd: root,
    cmd: ["bun", "run", "release:stable"],
  },
]

await mkdir(artifactDir, { recursive: true })

const results: StepResult[] = [await verifyMigrations()]
for (const step of steps) results.push(await run(step))

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  version: pkg.version,
  commit: (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim(),
  branch: (await Bun.$`git branch --show-current`.cwd(root).text()).trim(),
  status: results.every((item) => item.status === "passed") ? "passed" : "failed",
  results,
}

await Bun.write(path.join(artifactDir, "verification-report.json"), JSON.stringify(report, null, 2) + "\n")
await Bun.write(
  path.join(artifactDir, "verification-report.md"),
  [
    `# OpenAGt v${pkg.version} Verification Report`,
    "",
    `- Status: ${report.status}`,
    `- Commit: ${report.commit}`,
    `- Branch: ${report.branch}`,
    `- Generated: ${report.generated_at}`,
    "",
    "| Step | Status | Exit | Duration |",
    "| --- | --- | ---: | ---: |",
    ...results.map((item) => `| ${item.name} | ${item.status} | ${item.exitCode} | ${item.durationMs}ms |`),
    "",
    "## Failures",
    "",
    ...results
      .filter((item) => item.status === "failed")
      .flatMap((item) => [
        `### ${item.name}`,
        "",
        `Command: \`${item.cmd.join(" ")}\``,
        "",
        "```text",
        item.stderr || item.stdout || "(no output)",
        "```",
        "",
      ]),
  ].join("\n"),
)

console.log(`\nWrote ${path.relative(root, path.join(artifactDir, "verification-report.json"))}`)
console.log(`Wrote ${path.relative(root, path.join(artifactDir, "verification-report.md"))}`)

if (report.status === "failed") process.exit(1)
