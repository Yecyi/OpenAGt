#!/usr/bin/env bun

import { mkdir } from "node:fs/promises"
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

const focusedTests = [
  "test/server/security-middleware.test.ts",
  "test/tool/webfetch.test.ts",
  "test/util/sanitize-output.test.ts",
  "test/util/process.test.ts",
  "test/session/compaction.test.ts",
  "test/agent/coordinator-intent.test.ts",
  "test/agent/coordinator-personal.test.ts",
  "test/session/task-runtime-agentic.test.ts",
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
    name: "v1.20 focused security/runtime tests",
    cwd: path.join(root, "packages", "openagt"),
    cmd: ["bun", "test", ...focusedTests, "--timeout", "30000"],
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

const results: StepResult[] = []
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
