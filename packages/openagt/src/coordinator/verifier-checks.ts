export * as VerifierChecks from "./verifier-checks"

import type { TaskRuntime } from "@/session/task-runtime"
import type { CoordinatorNode as CoordinatorNodeType } from "./schema"
import type { VerifierSignalInput } from "./verifier-aggregator"

export type DeterministicVerifierCheck = {
  id: string
  source: "lsp_diagnostics" | "typecheck" | "test_subset"
  required: boolean
  command?: string
  workdir?: string
  files: string[]
  reason: string
}

const codeFile = /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/i
const testFile =
  /(^|[\\/])(?:test|tests|spec|__tests__)([\\/]|$)|(?:\.|_)(?:spec|test)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/i

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : []
}

function normalized(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\.\//, "")
}

function unique(values: string[]) {
  return [...new Set(values.map(normalized).filter(Boolean))]
}

function quote(value: string) {
  return `"${value.replaceAll('"', '\\"')}"`
}

function packageDir(scope: string) {
  const parts = normalized(scope).split("/")
  const index = parts.indexOf("packages")
  if (index >= 0 && parts[index + 1]) return parts.slice(0, index + 2).join("/")
  return "."
}

function dependencyScopes(node: CoordinatorNodeType, nodes: readonly CoordinatorNodeType[]) {
  return nodes
    .filter((item) => node.depends_on.includes(item.id))
    .flatMap((item) => [...item.write_scope, ...item.assigned_scope])
}

function metadataScopes(record: TaskRuntime.TaskRecord) {
  return unique([
    ...record.write_scope,
    ...record.read_scope,
    ...record.acceptance_checks,
    ...stringArray(record.metadata?.changed_scope),
    ...stringArray(record.metadata?.changed_files),
    ...stringArray(record.metadata?.touched_files),
  ])
}

function sourcePresent(signals: readonly VerifierSignalInput[], source: DeterministicVerifierCheck["source"]) {
  return signals.some((item) => item.source === source && item.status !== "timeout" && item.status !== "unavailable")
}

export function deterministicChecksForNode(node: CoordinatorNodeType, nodes: readonly CoordinatorNodeType[]) {
  if (node.task_kind !== "verify" && node.role !== "verifier" && node.output_schema !== "verification") return []
  const scopes = unique([...node.read_scope, ...node.assigned_scope, ...dependencyScopes(node, nodes)])
  const codeScopes = scopes.filter((item) => codeFile.test(item) || item.includes("/src/") || item.endsWith("/src"))
  const testScopes = scopes.filter((item) => testFile.test(item))
  const packages = unique((codeScopes.length ? codeScopes : scopes).map(packageDir))

  return [
    ...packages.map((dir) => ({
      id: `typecheck:${dir}`,
      source: "typecheck" as const,
      required: true,
      command: "bun typecheck",
      workdir: dir,
      files: codeScopes.filter((item) => packageDir(item) === dir).slice(0, 20),
      reason: `Typecheck is required for verifier coverage in ${dir}.`,
    })),
    ...(testScopes.length
      ? [
          {
            id: "focused-tests:touched",
            source: "test_subset" as const,
            required: false,
            command: `bun test ${testScopes.map(quote).join(" ")} --timeout 30000`,
            workdir: ".",
            files: testScopes.slice(0, 20),
            reason: "Touched test files can be re-run as focused verification.",
          },
        ]
      : []),
    ...(codeScopes.length
      ? [
          {
            id: "lsp-diagnostics:touched",
            source: "lsp_diagnostics" as const,
            required: false,
            files: codeScopes.slice(0, 20),
            reason: "Touched code files should provide LSP diagnostics when an LSP server is available.",
          },
        ]
      : []),
  ] satisfies DeterministicVerifierCheck[]
}

export function deterministicChecksForTask(record: TaskRuntime.TaskRecord) {
  const scopes = metadataScopes(record)
  const packages = unique((scopes.length ? scopes : ["."]).map(packageDir))
  const codeScopes = scopes.filter((item) => codeFile.test(item) || item.includes("/src/") || item.endsWith("/src"))
  const testScopes = scopes.filter((item) => testFile.test(item))
  return [
    ...packages.map((dir) => ({
      id: `typecheck:${dir}`,
      source: "typecheck" as const,
      required: true,
      command: "bun typecheck",
      workdir: dir,
      files: codeScopes.filter((item) => packageDir(item) === dir).slice(0, 20),
      reason: `Typecheck evidence is expected for verifier task ${record.description}.`,
    })),
    ...(testScopes.length
      ? [
          {
            id: "focused-tests:touched",
            source: "test_subset" as const,
            required: false,
            command: `bun test ${testScopes.map(quote).join(" ")} --timeout 30000`,
            workdir: ".",
            files: testScopes.slice(0, 20),
            reason: "Focused tests are available from touched test files.",
          },
        ]
      : []),
    ...(codeScopes.length
      ? [
          {
            id: "lsp-diagnostics:touched",
            source: "lsp_diagnostics" as const,
            required: false,
            files: codeScopes.slice(0, 20),
            reason: "LSP diagnostics can provide additional deterministic evidence.",
          },
        ]
      : []),
  ] satisfies DeterministicVerifierCheck[]
}

export function metadataChecks(value: unknown): DeterministicVerifierCheck[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const source = record.source
    if (source !== "lsp_diagnostics" && source !== "typecheck" && source !== "test_subset") return []
    return [
      {
        id: typeof record.id === "string" ? record.id : source,
        source,
        required: record.required === true,
        command: typeof record.command === "string" ? record.command : undefined,
        workdir: typeof record.workdir === "string" ? record.workdir : undefined,
        files: stringArray(record.files),
        reason: typeof record.reason === "string" ? record.reason : "Deterministic verifier evidence expected.",
      },
    ]
  })
}

export function missingDeterministicSignals(
  checks: readonly DeterministicVerifierCheck[],
  observed: readonly VerifierSignalInput[],
) {
  return checks
    .filter((item) => item.required && !sourcePresent(observed, item.source))
    .map((item) => ({
      source: item.source,
      status: "unavailable" as const,
      summary: `Missing required deterministic evidence: ${item.reason}`,
      evidence: [
        item.command ? `suggested command: ${item.command}` : undefined,
        item.workdir ? `workdir: ${item.workdir}` : undefined,
        item.files.length ? `scope: ${item.files.slice(0, 5).join(", ")}` : undefined,
      ].filter((entry): entry is string => Boolean(entry)),
    }))
}
