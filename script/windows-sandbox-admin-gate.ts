#!/usr/bin/env bun

import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const manifest = path.join(root, "packages", "openagt-sandbox-win", "Cargo.toml")
const artifactDir = path.join(root, ".artifacts", "windows-sandbox")
const reportPath = path.join(artifactDir, "admin-gate-report.json")
const markdownReportPath = path.join(artifactDir, "admin-gate-report.md")
const preflightOnly = process.argv.includes("--preflight-only")

type StepResult = {
  name: string
  cmd: string[]
  status: "passed" | "failed"
  exitCode: number
  durationMs: number
  stdout: string
  stderr: string
}

type HelperProof = {
  status: "passed" | "failed" | "skipped"
  helper_version: string | null
  helper_protocol_version: number | null
  helper_sha256: string | null
  stdout: string
  stderr: string
}

type AdminGateReport = {
  schema_version: 1
  gate: "windows_sandbox_admin_preflight" | "windows_sandbox_admin_execution"
  generated_at: string
  commit: string
  branch: string
  status: "passed" | "failed" | "skipped"
  helper: HelperProof
  preflight: {
    platform: NodeJS.Platform
    elevated: boolean
    cargo: string | null
    manifest: string
    manifest_exists: boolean
  }
  results: StepResult[]
  notes: string[]
}

function trim(value: string) {
  if (value.length <= 16_000) return value
  return `${value.slice(0, 16_000)}\n...[truncated ${value.length - 16_000} chars]`
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

function isElevated() {
  if (process.platform !== "win32") return false
  const check = Bun.spawnSync({
    cmd: [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    ],
    stdout: "pipe",
    stderr: "pipe",
  })
  return check.exitCode === 0 && check.stdout.toString().trim().toLowerCase() === "true"
}

async function run(name: string, cmd: string[], env: NodeJS.ProcessEnv = process.env): Promise<StepResult> {
  const started = Date.now()
  console.log(`\n=== ${name} ===`)
  console.log(`${root}> ${cmd.join(" ")}`)
  const proc = Bun.spawn(cmd, {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (stdout.trim()) console.log(stdout)
  if (stderr.trim()) console.error(stderr)
  return {
    name,
    cmd,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    durationMs: Date.now() - started,
    stdout: trim(stdout),
    stderr: trim(stderr),
  }
}

function probeHelper(cargo: string | undefined, manifestExists: boolean): HelperProof {
  if (!cargo || !manifestExists) {
    return {
      status: "skipped",
      helper_version: null,
      helper_protocol_version: null,
      helper_sha256: null,
      stdout: "",
      stderr: !cargo ? "cargo missing" : "helper manifest missing",
    }
  }
  const result = Bun.spawnSync({
    cmd: [cargo, "run", "--quiet", "--manifest-path", manifest, "--", "probe", "--json"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  if (result.exitCode !== 0) {
    return {
      status: "failed",
      helper_version: null,
      helper_protocol_version: null,
      helper_sha256: null,
      stdout: trim(stdout),
      stderr: trim(stderr),
    }
  }
  try {
    const parsed = JSON.parse(stdout) as {
      helper_version?: unknown
      helper_protocol_version?: unknown
      helper_sha256?: unknown
    }
    return {
      status: "passed",
      helper_version: typeof parsed.helper_version === "string" ? parsed.helper_version : null,
      helper_protocol_version:
        typeof parsed.helper_protocol_version === "number" ? parsed.helper_protocol_version : null,
      helper_sha256: typeof parsed.helper_sha256 === "string" ? parsed.helper_sha256 : null,
      stdout: trim(stdout),
      stderr: trim(stderr),
    }
  } catch (err) {
    return {
      status: "failed",
      helper_version: null,
      helper_protocol_version: null,
      helper_sha256: null,
      stdout: trim(stdout),
      stderr: err instanceof Error ? err.message : String(err),
    }
  }
}

async function writeReport(report: AdminGateReport) {
  await Bun.write(reportPath, JSON.stringify(report, null, 2) + "\n")
  await Bun.write(
    markdownReportPath,
    [
      "# Windows Sandbox Admin Gate",
      "",
      `- Status: ${report.status}`,
      `- Gate: ${report.gate}`,
      `- Commit: ${report.commit}`,
      `- Branch: ${report.branch}`,
      `- Generated: ${report.generated_at}`,
      `- Helper probe: ${report.helper.status}`,
      `- Helper version: ${report.helper.helper_version ?? "unknown"}`,
      `- Helper protocol: ${report.helper.helper_protocol_version ?? "unknown"}`,
      `- Helper SHA256: ${report.helper.helper_sha256 ?? "unknown"}`,
      `- Elevated: ${report.preflight.elevated ? "yes" : "no"}`,
      `- Cargo: ${report.preflight.cargo ?? "missing"}`,
      "",
      "| Step | Status | Exit | Duration |",
      "| --- | --- | ---: | ---: |",
      ...report.results.map((item) => `| ${item.name} | ${item.status} | ${item.exitCode} | ${item.durationMs}ms |`),
      "",
      "## Notes",
      "",
      ...report.notes.map((item) => `- ${item}`),
      "",
    ].join("\n"),
  )

  console.log(`\nWrote ${path.relative(root, reportPath)}`)
  console.log(`Wrote ${path.relative(root, markdownReportPath)}`)
}

await mkdir(artifactDir, { recursive: true })

const cargo = findCargo()
const preflight = {
  platform: process.platform,
  elevated: isElevated(),
  cargo: cargo ?? null,
  manifest,
  manifest_exists: await Bun.file(manifest).exists(),
}
const helper = probeHelper(cargo, preflight.manifest_exists)

const preflightFailures = [
  process.platform !== "win32" ? "Windows sandbox admin gate can only run on Windows." : undefined,
  !preflight.elevated ? "Windows sandbox admin gate requires an elevated Administrator terminal." : undefined,
  !cargo ? "Rust cargo is required to run the Windows sandbox admin gate." : undefined,
  !preflight.manifest_exists ? `Windows sandbox helper manifest not found: ${manifest}` : undefined,
  helper.status === "failed" ? "Windows sandbox helper probe failed." : undefined,
].filter((item): item is string => item !== undefined)

if (preflightOnly || preflightFailures.length) {
  await writeReport({
    schema_version: 1,
    gate: "windows_sandbox_admin_preflight",
    generated_at: new Date().toISOString(),
    commit: (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim(),
    branch: (await Bun.$`git branch --show-current`.cwd(root).text()).trim(),
    status: preflightFailures.length ? "skipped" : "passed",
    helper,
    preflight,
    results: [],
    notes: [
      "This gate is intentionally manual/admin-only because it installs and removes OpenAGt WFP rules.",
      "Run without --preflight-only from an elevated Windows terminal to execute the destructive gate.",
      ...preflightFailures,
    ],
  })
  if (preflightFailures.length) {
    for (const item of preflightFailures) console.error(item)
    process.exit(0)
  }
  process.exit(0)
}

const results = [
  await run(
    "Windows sandbox setup status before",
    [cargo, "run", "--quiet", "--manifest-path", manifest, "--", "setup", "--status", "--json"],
    {
      ...process.env,
      OPENAGT_SANDBOX_WINDOWS_ADMIN_GATE_REPORT: reportPath,
    },
  ),
  await run("Windows sandbox WFP execution gate", [cargo, "test", "--manifest-path", manifest], {
    ...process.env,
    OPENAGT_RUN_WINDOWS_WFP_TESTS: "1",
    OPENAGT_SANDBOX_WINDOWS_ADMIN_GATE_REPORT: reportPath,
  }),
  await run(
    "Windows sandbox setup status after",
    [cargo, "run", "--quiet", "--manifest-path", manifest, "--", "setup", "--status", "--json"],
    {
      ...process.env,
      OPENAGT_SANDBOX_WINDOWS_ADMIN_GATE_REPORT: reportPath,
    },
  ),
]

const report = {
  schema_version: 1,
  gate: "windows_sandbox_admin_execution",
  generated_at: new Date().toISOString(),
  commit: (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim(),
  branch: (await Bun.$`git branch --show-current`.cwd(root).text()).trim(),
  status: helper.status === "passed" && results.every((item) => item.status === "passed") ? "passed" : "failed",
  helper,
  preflight,
  results,
  notes: [
    "This gate is intentionally manual/admin-only because it installs and removes OpenAGt WFP rules.",
    "The helper tests restore the pre-existing WFP setup state after execution.",
  ],
} satisfies AdminGateReport

await writeReport(report)

if (report.status === "failed") process.exit(1)
