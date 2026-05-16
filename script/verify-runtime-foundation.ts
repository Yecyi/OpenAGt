#!/usr/bin/env bun

const groups = [
  {
    name: "personal-memory",
    files: [
      "test/personal/consolidator.test.ts",
      "test/personal/three-layer-enrichment.test.ts",
      "test/personal/three-layer.test.ts",
      "test/memory/abort-leak.test.ts",
      "test/agent/coordinator-personal.test.ts",
    ],
  },
  {
    name: "storage-sync",
    files: [
      "test/storage/db.test.ts",
      "test/storage/json-migration.test.ts",
      "test/storage/storage.test.ts",
      "test/sync/index.test.ts",
    ],
  },
  {
    name: "edit-lsp-learning",
    files: ["test/tool/edit.test.ts", "test/tool/write.test.ts", "test/lsp/feedback.test.ts", "test/agent/coordinator-learning-loop.test.ts"],
  },
  {
    name: "sandbox-security-shell",
    files: ["test/sandbox/status.test.ts", "test/sandbox/broker.test.ts", "test/security/decision-pipeline.test.ts", "test/shell/runner.test.ts"],
  },
  {
    name: "provider-session",
    files: [
      "test/provider/amazon-bedrock.test.ts",
      "test/provider/fallback-service.test.ts",
      "test/provider/gitlab-duo.test.ts",
      "test/provider/model-catalog-policy.test.ts",
      "test/provider/provider.test.ts",
      "test/provider/transform.test.ts",
      "test/session/system-prompt.test.ts",
      "test/session/task-runtime-agentic.test.ts",
    ],
  },
]

async function runGroup(group: (typeof groups)[number]) {
  console.log(`\n=== Runtime foundation: ${group.name} ===\n`)
  const proc = Bun.spawn({
    cmd: ["bun", "test", ...group.files, "--timeout", "30000"],
    cwd: "packages/openagt",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(`${group.name} failed with exit code ${exitCode}`)
}

for (const group of groups) {
  await runGroup(group)
}
