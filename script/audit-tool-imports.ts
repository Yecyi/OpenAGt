// Audit tool/*.ts import statements for chains that re-create the
// Agent.defaultLayer TDZ trap.
//
// Background:
//   - tool/registry.ts loads every Tool implementation at module-init time
//     (it must, because the registry holds the resolved Service-tag list).
//   - personal/personal.ts has a top-level `import { Coordinator } from
//     "../coordinator/coordinator"` for `subscribeCallback`-side wiring.
//   - coordinator/coordinator.ts at line 505 calls
//     `Layer.provide(Agent.defaultLayer)` at module-init.
//   - When a test loads tool/registry.ts, the chain
//     registry -> escalate_to_inbox -> personal/personal -> coordinator/coordinator
//     pulls Agent.defaultLayer at the point its own module body is still
//     evaluating, hitting a temporal-dead-zone error.
//
// Wave 11 A1 fix (commit ad2891da8) extracted the PersonalAgent Service tag
// to personal/service.ts so the tool layer can `import { Service }` from a
// file that does NOT chain into Coordinator. This audit pins that contract:
// any future tool implementation that imports the personal/personal,
// coordinator/coordinator, or agent/agent value-namespaces is rejected.
//
// Type-only imports are safe (they're erased at compile time and never
// trigger module load), so they're skipped.
//
// Output mirrors script/audit-prompt-affect.ts: human-readable report by
// default, JSON with --json, CI gate with --fail-on-block.

import path from "path"

export type Severity = "block" | "warn"

export interface Rule {
  id: string
  severity: Severity
  // Match this module specifier exactly (after stripping leading ./ ../ and "@/")
  // against the import statement's source path.
  bannedPath: string
  rationale: string
  allowedAlternative: string
}

export const RULES: readonly Rule[] = [
  {
    id: "tool-import.personal-personal",
    severity: "block",
    bannedPath: "personal/personal",
    rationale:
      "personal/personal.ts pulls coordinator/coordinator at module load; that chain hits TDZ on Agent.defaultLayer when a test loads tool/registry.",
    allowedAlternative: 'import { Service } from "../personal/service" — the Service tag lives in service.ts to break this chain.',
  },
  {
    id: "tool-import.coordinator-coordinator",
    severity: "block",
    bannedPath: "coordinator/coordinator",
    rationale:
      "coordinator/coordinator.ts:505 invokes Layer.provide(Agent.defaultLayer) at module-init. Importing it from a tool file recreates the TDZ trap.",
    allowedAlternative:
      'import type-only types from coordinator/schema-*.ts files, or move the value lookup into an Effect.gen body where the layer is already resolved.',
  },
  {
    id: "tool-import.agent-agent",
    severity: "warn",
    bannedPath: "agent/agent",
    rationale:
      "agent/agent.ts is the home of Agent.defaultLayer (the TDZ target). Direct value imports from a tool implementation are a yellow flag — they happen to work today only because the load order keeps them after coordinator's Layer.provide settles.",
    allowedAlternative:
      'Prefer `import type { Agent } from "../agent/agent"`. If you need the Agent value namespace at runtime, resolve it inside an Effect.gen body via `yield* Agent.Service` rather than at module top level.',
  },
] as const

// Files in tool/ that are NOT individual Tool implementations but the loader
// or framework shared by all tools. They run earlier in the load order than
// the tool files themselves and don't recreate the TDZ trap from this side.
// Keep this list TIGHT — the default is "scan it".
export const FRAMEWORK_EXCEPTIONS = new Set<string>([
  "packages/openagt/src/tool/registry.ts", // the loader itself
  "packages/openagt/src/tool/tool.ts", // Tool.define + Metadata helpers
  "packages/openagt/src/tool/truncate.ts", // truncation service framework
])

export const SCAN_GLOB = "packages/openagt/src/tool/*.ts"

export interface Finding {
  file: string
  line: number
  col: number
  rule: Rule
  importPath: string
  snippet: string
}

const repoRoot = path.resolve(import.meta.dir, "..")

const collectFiles = async () => {
  const seen = new Set<string>()
  for await (const rel of new Bun.Glob(SCAN_GLOB).scan({ cwd: repoRoot })) {
    seen.add(rel.replaceAll("\\", "/"))
  }
  return [...seen].sort()
}

// Strip leading `./`, `../`, `@/`, and any number of `../` segments.
export function normalizeImportPath(spec: string): string {
  let out = spec
  if (out.startsWith("@/")) out = out.slice(2)
  while (out.startsWith("./") || out.startsWith("../")) {
    out = out.startsWith("../") ? out.slice(3) : out.slice(2)
  }
  // Drop a trailing extension if present (rare in this codebase but defensive).
  out = out.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/u, "")
  return out
}

// Match a top-of-line import statement and return its source spec.
// Skips type-only imports — `import type { ... } from "..."` is safe.
const IMPORT_RE = /^\s*import\s+(?<typeKw>type\s+)?(?:[\s\S]*?)from\s+["'](?<spec>[^"']+)["']/u

export function parseImportLine(line: string): { spec: string; isTypeOnly: boolean } | null {
  const match = IMPORT_RE.exec(line)
  if (!match || !match.groups) return null
  return { spec: match.groups.spec, isTypeOnly: Boolean(match.groups.typeKw) }
}

// Scan a file's text directly — useful for tests where the fixture lives
// outside the default scan glob and you don't want to round-trip via disk.
export function scanText(rel: string, text: string): Finding[] {
  if (FRAMEWORK_EXCEPTIONS.has(rel)) return []
  const lines = text.split("\n")
  const findings: Finding[] = []
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseImportLine(lines[i])
    if (!parsed) continue
    if (parsed.isTypeOnly) continue
    const normalized = normalizeImportPath(parsed.spec)
    for (const rule of RULES) {
      // Suffix-or-equal match. The banned-path is `personal/personal`, but a
      // module specifier might be `../personal/personal`, `@/personal/personal`,
      // or even `packages/openagt/src/personal/personal` (in test fixtures);
      // they all normalize to a path that *ends with* `/personal/personal`
      // (or equals it directly when the module is at the root of the search).
      const isMatch = normalized === rule.bannedPath || normalized.endsWith("/" + rule.bannedPath)
      if (isMatch) {
        findings.push({
          file: rel,
          line: i + 1,
          col: lines[i].indexOf("import") + 1,
          rule,
          importPath: parsed.spec,
          snippet: lines[i].trim(),
        })
      }
    }
  }
  return findings
}

export async function scanFile(rel: string): Promise<Finding[]> {
  return scanText(rel, await Bun.file(path.join(repoRoot, rel)).text())
}

if (!import.meta.main) {
  // Imported for testing — skip the CLI body below. Tests should call
  // scanText / scanFile / RULES directly.
} else {
const args = Bun.argv.slice(2)
const failOnBlock = args.includes("--fail-on-block")
const asJson = args.includes("--json")

const files = await collectFiles()
const findings = (await Promise.all(files.map(scanFile))).flat()
const blocked = findings.filter((f) => f.rule.severity === "block")
const warned = findings.filter((f) => f.rule.severity === "warn")

if (asJson) {
  console.log(
    JSON.stringify(
      {
        summary: {
          files_scanned: files.length,
          files_with_findings: new Set(findings.map((f) => f.file)).size,
          total: findings.length,
          block: blocked.length,
          warn: warned.length,
        },
        framework_exceptions: [...FRAMEWORK_EXCEPTIONS],
        findings: findings.map((f) => ({
          file: f.file,
          line: f.line,
          col: f.col,
          rule: f.rule.id,
          severity: f.rule.severity,
          import_path: f.importPath,
          snippet: f.snippet,
          rationale: f.rule.rationale,
          allowed_alternative: f.rule.allowedAlternative,
        })),
      },
      null,
      2,
    ),
  )
  process.exit(failOnBlock && blocked.length > 0 ? 1 : 0)
}

console.log(`# Tool-Registry Import Audit\n`)
console.log(
  `Scanned ${files.length} files in ${SCAN_GLOB} (${FRAMEWORK_EXCEPTIONS.size} framework exceptions excluded); ` +
    `${findings.length} findings (${blocked.length} block, ${warned.length} warn).\n`,
)

if (findings.length === 0) {
  console.log("OK — no banned imports detected.\n")
  process.exit(0)
}

const byFile = new Map<string, Finding[]>()
for (const f of findings) {
  const list = byFile.get(f.file) ?? []
  list.push(f)
  byFile.set(f.file, list)
}

for (const [file, ms] of byFile) {
  console.log(`## ${file}`)
  for (const m of ms) {
    console.log(`  - line ${m.line}: [${m.rule.severity.toUpperCase()}] ${m.rule.id}`)
    console.log(`      import: ${m.snippet}`)
    console.log(`      why:    ${m.rule.rationale}`)
    console.log(`      fix:    ${m.rule.allowedAlternative}`)
  }
  console.log("")
}

if (failOnBlock && blocked.length > 0) {
  console.error(`FAIL: ${blocked.length} block-severity violation(s).`)
  process.exit(1)
}
process.exit(0)
}
