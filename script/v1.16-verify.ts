#!/usr/bin/env bun

import { Glob } from "bun"
import { mkdir } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const artifactDir = path.join(root, ".artifacts", "v1.16")

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

function truncate(value: string) {
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
    stdout: truncate(stdout),
    stderr: truncate(stderr),
  }
}

async function securityTests() {
  const files = await Array.fromAsync(
    new Glob("test/security/*.test.ts").scan({ cwd: path.join(root, "packages", "openagt") }),
  )
  return files.sort()
}

const openagtTests = [
  "test/agent/coordinator-personal.test.ts",
  "test/agent/coordinator-intent.test.ts",
  "test/agent/coordinator-runner.test.ts",
  "test/session/task-runtime-agentic.test.ts",
  "test/tool/task.test.ts",
  "test/server/event-envelope.test.ts",
  "test/cli/smoke.test.ts",
]

const steps: Step[] = [
  {
    name: "OpenAGt typecheck",
    cwd: path.join(root, "packages", "openagt"),
    cmd: ["bun", "typecheck"],
  },
  {
    name: "OpenAGt focused coordinator/task/debug tests",
    cwd: path.join(root, "packages", "openagt"),
    cmd: ["bun", "test", ...openagtTests, "--timeout", "30000"],
  },
  {
    name: "OpenAGt security tests",
    cwd: path.join(root, "packages", "openagt"),
    cmd: ["bun", "test", ...(await securityTests()), "--timeout", "30000"],
  },
  {
    name: "SDK typecheck",
    cwd: path.join(root, "packages", "sdk", "js"),
    cmd: ["bun", "typecheck"],
  },
  {
    name: "SDK helper tests",
    cwd: path.join(root, "packages", "sdk", "js"),
    cmd: ["bun", "test", "test/runtime-helpers.test.ts", "--timeout", "30000"],
  },
  {
    name: "SDK generation",
    cwd: root,
    cmd: ["bun", "./packages/sdk/js/script/build.ts"],
  },
  {
    name: "Release verification",
    cwd: root,
    cmd: ["bun", "run", "release:verify"],
  },
]

await mkdir(artifactDir, { recursive: true })

const results: StepResult[] = []
for (const step of steps) results.push(await run(step))

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  commit: (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim(),
  branch: (await Bun.$`git branch --show-current`.cwd(root).text()).trim(),
  status: results.every((item) => item.status === "passed") ? "passed" : "failed",
  results,
}

const markdown = [
  "# OpenAGt v1.16 Verification Report",
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
]

await Bun.write(path.join(artifactDir, "verification-report.json"), JSON.stringify(report, null, 2) + "\n")
await Bun.write(path.join(artifactDir, "verification-report.md"), markdown.join("\n"))

console.log(`\nWrote ${path.relative(root, path.join(artifactDir, "verification-report.json"))}`)
console.log(`Wrote ${path.relative(root, path.join(artifactDir, "verification-report.md"))}`)

if (report.status === "failed") process.exit(1)
