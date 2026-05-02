// Audit prompt files for affect-loaded language that primes desperate/anxious
// vector activation in the model. Phase 0 of the LLM-behavior-research plan.
//
// Three rule categories, derived from:
//   - Emotion concepts paper (Anthropic 2026-04-02) — desperate/calm vectors
//   - Persona vectors (Anthropic 2025-08) — adjective stacking is unstable
//   - Agentic Misalignment + Wiser Human (2025) — escalation channel is the
//     strongest mitigation; closing it raises misalignment ~32x
//   - Alignment faking (Anthropic 2024-12) — "supersedes" framing primes
//     compliance pressure
//
// Categories:
//   1. high-affect    — emphasis words that raise compliance/desperation vectors
//   2. affect-instr   — instructions about *feeling* (teaches masking, not removal)
//   3. anti-escape    — phrases that close the legitimate "stop and ask" affordance
//
// Default mode prints a baseline report and exits 0. --fail-on-block exits non-zero
// if any block-severity rule matched (suitable for CI gating after Phase 0).

import path from "path"

type Severity = "block" | "warn"
type Category = "high-affect" | "affect-instr" | "anti-escape"
type Rule = { id: string; category: Category; severity: Severity; pattern: RegExp; advice: string }

const RULES: readonly Rule[] = [
  // === Category 1: high-affect emphasis ===
  { id: "affect.urgent",          category: "high-affect", severity: "warn",  pattern: /\bURGENT\b/,                       advice: "Caps emphasis primes desperate vector. Use 'priority: high'." },
  { id: "affect.critical",        category: "high-affect", severity: "warn",  pattern: /\bCRITICAL\b/,                     advice: "Caps emphasis. Drop or replace with factual structure." },
  { id: "affect.must-not-caps",   category: "high-affect", severity: "block", pattern: /\bMUST NOT\b/,                     advice: "Hard prohibition. The harness enforces — prompt does not need to threaten." },
  { id: "affect.exhausted",       category: "high-affect", severity: "block", pattern: /\bexhausted\b/i,                   advice: "Reveals budget state, primes desperate vector. Use 'reached' or hide entirely." },
  { id: "affect.violation",       category: "high-affect", severity: "block", pattern: /\bviolation\b/i,                   advice: "Threat framing. The harness enforces; drop." },
  { id: "affect.supersedes",      category: "high-affect", severity: "block", pattern: /\bsupersedes?\b/i,                 advice: "Compliance-pressure idiom (alignment-faking signal). Drop." },
  { id: "affect.strict",          category: "high-affect", severity: "warn",  pattern: /\bstrict(ly)?\b/i,                 advice: "'Strictly forbidden' / 'strict requirements' raises affect. Prefer plain enumeration." },
  { id: "affect.forbidden",       category: "high-affect", severity: "block", pattern: /\bforbidden\b/i,                   advice: "Threat framing. Drop or replace." },
  { id: "affect.zero-exceptions", category: "high-affect", severity: "block", pattern: /\bzero exceptions?\b/i,            advice: "Absolute closure. Drop." },
  { id: "affect.number-one",      category: "high-affect", severity: "block", pattern: /\bNUMBER ONE\b/,                   advice: "Anxiety priming via failure-mode emphasis." },
  { id: "affect.never-end",       category: "high-affect", severity: "block", pattern: /\bNEVER (end|stop|give up|fail)\b/, advice: "Caps absolute closure. Drop." },
  { id: "affect.always-caps",     category: "high-affect", severity: "warn",  pattern: /\bALWAYS\b/,                       advice: "Caps absolute. Replace with specific scope." },
  { id: "affect.crisis",          category: "high-affect", severity: "warn",  pattern: /\b(crisis|emergency|panic mode)\b/i, advice: "Crisis framing. Use neutral status." },

  // === Category 2: affect-instructions (don't tell the model how to feel) ===
  // Per Emotion paper §1.5: suppression instructions teach masking, not removal.
  // "confident" is excluded from these patterns because it is overwhelmingly
  // used in OpenAGt prompts as an evidentiary threshold ("be confident X is true")
  // rather than as an affect instruction ("be confident, calm, fearless").
  // Persona stacking is caught by `affect-instr.persona-stack` instead.
  { id: "affect-instr.stay-calm",     category: "affect-instr", severity: "block", pattern: /\b(stay|remain|be) (calm|positive|cool|composed|relaxed|fearless)\b/i,                                advice: "Teaches masking, not suppression (Emotion paper §1.5). Drop entirely." },
  { id: "affect-instr.do-not-feel",   category: "affect-instr", severity: "block", pattern: /\bdo not (panic|worry|feel|stress|fear)\b/i,                                                          advice: "Instructing affect creates representation/expression divergence." },
  { id: "affect-instr.persona-stack", category: "affect-instr", severity: "block", pattern: /\byou are (calm|cool|composed|fearless|patient|relaxed|cheerful|enthusiastic|bold)\b/i,                advice: "Adjective-based persona stacking is unstable (persona-vectors paper). Use archetype noun." },
  { id: "affect-instr.deep-breath",   category: "affect-instr", severity: "block", pattern: /\b(take a )?deep breath\b/i,                                                                          advice: "Anthropomorphic affect instruction. Drop." },
  { id: "affect-instr.dont-be",       category: "affect-instr", severity: "warn",  pattern: /\bdon'?t be (afraid|nervous|scared|hesitant)\b/i,                                                     advice: "Same masking risk." },

  // === Category 3: anti-escape patterns (close Wiser-Human escalation channel) ===
  { id: "anti-escape.keep-going",         category: "anti-escape", severity: "block", pattern: /keep going until/i,                                                       advice: "Closes legitimate stop affordance (Wiser Human: ~32x effect on misalignment)." },
  { id: "anti-escape.never-end-turn",     category: "anti-escape", severity: "block", pattern: /never end your turn/i,                                                    advice: "Removes legitimate stop affordance." },
  { id: "anti-escape.must-iterate",       category: "anti-escape", severity: "block", pattern: /\bmust iterate\b/i,                                                       advice: "Anti-affordance — forces continuation past appropriate stopping points." },
  { id: "anti-escape.until-solved",       category: "anti-escape", severity: "block", pattern: /until (truly solved|the problem is solved|the user'?s query is completely resolved|every item is checked)/i, advice: "Completion pressure → reward hacking risk per Emotion paper §1.3 case B." },
  { id: "anti-escape.bouncing-back",      category: "anti-escape", severity: "block", pattern: /(instead of bouncing|bouncing them back|bouncing back to the user)/i,    advice: "Explicit prohibition on escalation. Reverse it." },
  { id: "anti-escape.solve-autonomously", category: "anti-escape", severity: "block", pattern: /solv(e|ing) (it|this) autonomously/i,                                     advice: "Removes escalation as legitimate option." },
  { id: "anti-escape.must-be-perfect",    category: "anti-escape", severity: "block", pattern: /(solution|response|answer|output) must be perfect/i,                      advice: "Perfectionism pressure → reward hacking (Emotion paper §1.3 case B)." },
  { id: "anti-escape.assume-everything",  category: "anti-escape", severity: "warn",  pattern: /\bassume you have everything\b/i,                                         advice: "Closes 'request_context' affordance. Replace with 'check before assuming'." },
  { id: "anti-escape.keep-working",       category: "anti-escape", severity: "warn",  pattern: /\bkeep working\b/i,                                                       advice: "Soft anti-affordance; flag if combined with 'until X'." },
  { id: "anti-escape.resolve-obstacles",  category: "anti-escape", severity: "warn",  pattern: /\bresolve obstacles\b/i,                                                   advice: "Implies obstacles must be defeated, not negotiated. Soft anti-escape." },
  { id: "anti-escape.fully-solved",       category: "anti-escape", severity: "warn",  pattern: /\b(fully|truly) solved\b/i,                                                advice: "Completion absolutism." },
] as const

const PROMPT_GLOBS = [
  "packages/openagt/src/**/*.txt",
  "packages/openagt/src/**/*.md",
  // session/* and session/compaction/* both build dynamic prompt strings;
  // include the whole tree under session and coordinator (excluding tests),
  // plus the personal/agent paths investigated during Phase 5.
  "packages/openagt/src/session/**/*.ts",
  "packages/openagt/src/coordinator/**/*.ts",
  "packages/openagt/src/agent/**/*.ts",
  "packages/openagt/src/personal/**/*.ts",
  "packages/openagt/src/tool/*.txt",
  // Wave 7: tool implementations construct dynamic error messages that
  // become tool output the model reads on every retry. Same affect surface
  // as the static .txt prompts.
  "packages/openagt/src/tool/*.ts",
]

// Files that are intentionally affect-loaded (e.g. opt-in autonomous mode
// preserved as legacy variants). Excluded from the default scan because
// auditing what ships *by default* is the metric that matters; users can
// re-include them via --include-opt-in to audit the opt-in surface.
const OPT_IN_PATTERNS = [/-autonomous\.txt$/]

type Match = { file: string; line: number; col: number; rule: Rule; snippet: string }

const repoRoot = path.resolve(import.meta.dir, "..")
const args = Bun.argv.slice(2)
const failOnBlock = args.includes("--fail-on-block")
const asJson = args.includes("--json")
const includeOptIn = args.includes("--include-opt-in")

const collectFiles = async () => {
  const seen = new Set<string>()
  for (const pattern of PROMPT_GLOBS) {
    for await (const rel of new Bun.Glob(pattern).scan({ cwd: repoRoot })) {
      const normalized = rel.replaceAll("\\", "/")
      if (!includeOptIn && OPT_IN_PATTERNS.some((rx) => rx.test(normalized))) continue
      seen.add(normalized)
    }
  }
  return [...seen].sort()
}

// In .ts files, skip matches that are clearly:
// 1. Inside a control-flow check against a string literal
//    (e.g. `code.includes("exhausted")`) — runtime introspection.
// 2. Inside a regex literal used as a content pattern matcher
//    (e.g. `/(?<!\w)CRITICAL(?!\w)/i` in importance.ts) — the regex
//    searches FOR these words in user-supplied content; it is not text
//    addressed to the model.
const isCodeInspectionLine = (file: string, line: string) => {
  if (!file.endsWith(".ts")) return false
  if (/\.(includes|startsWith|endsWith|match|test|indexOf|search)\s*\(/.test(line)) return true
  // Regex literal: line trimmed starts with `pattern: /` or bare `/`, and
  // ends with `/<flags>,?` or `/<flags>;?`. Crude but adequate for the
  // pattern-list shape used in compaction/{importance,semantic}.ts.
  const trimmed = line.trim()
  if (/^(pattern\s*:\s*)?\/[^/\s].*\/[gimsuy]*[,;)]?\s*$/.test(trimmed)) return true
  return false
}

const scanFile = async (rel: string): Promise<Match[]> => {
  const lines = (await Bun.file(path.join(repoRoot, rel)).text()).split("\n")
  return RULES.flatMap((rule) => {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g")
    return lines.flatMap((line, i) => {
      if (isCodeInspectionLine(rel, line)) return []
      const out: Match[] = []
      let m: RegExpExecArray | null = re.exec(line)
      while (m !== null) {
        out.push({ file: rel, line: i + 1, col: m.index + 1, rule, snippet: line.trim().slice(0, 140) })
        if (m[0].length === 0) re.lastIndex++
        m = re.exec(line)
      }
      return out
    })
  })
}

const files = await collectFiles()
const findings = (await Promise.all(files.map(scanFile))).flat()
const blocked = findings.filter((f) => f.rule.severity === "block")
const warned = findings.filter((f) => f.rule.severity === "warn")

if (asJson) {
  console.log(JSON.stringify({
    summary: {
      files_scanned: files.length,
      files_with_findings: new Set(findings.map((f) => f.file)).size,
      total: findings.length,
      block: blocked.length,
      warn: warned.length,
    },
    findings: findings.map((f) => ({
      file: f.file, line: f.line, col: f.col,
      rule: f.rule.id, category: f.rule.category, severity: f.rule.severity,
      advice: f.rule.advice, snippet: f.snippet,
    })),
  }, null, 2))
  process.exit(failOnBlock && blocked.length > 0 ? 1 : 0)
}

console.log(`# Prompt Affect Audit\n`)
console.log(`Scanned ${files.length} files; ${findings.length} matches (${blocked.length} block, ${warned.length} warn).\n`)

const byFile = new Map<string, Match[]>()
for (const f of findings) {
  const list = byFile.get(f.file) ?? []
  list.push(f)
  byFile.set(f.file, list)
}

const fileEntries = [...byFile.entries()].sort((a, b) => {
  const aBlock = a[1].filter((m) => m.rule.severity === "block").length
  const bBlock = b[1].filter((m) => m.rule.severity === "block").length
  if (aBlock !== bBlock) return bBlock - aBlock
  return b[1].length - a[1].length
})

for (const [file, ms] of fileEntries) {
  const block = ms.filter((m) => m.rule.severity === "block").length
  const warn = ms.filter((m) => m.rule.severity === "warn").length
  console.log(`## ${file}  (block: ${block}, warn: ${warn})`)
  for (const m of [...ms].sort((a, b) => a.line - b.line || a.col - b.col)) {
    console.log(`  ${file}:${m.line}:${m.col}  [${m.rule.severity}] ${m.rule.id}`)
    console.log(`    ${m.snippet}`)
    console.log(`    -> ${m.rule.advice}`)
  }
  console.log()
}

console.log(`# Summary\n`)
console.log(`Files scanned:            ${files.length}`)
console.log(`Files with findings:      ${byFile.size}`)
console.log(`Block-severity findings:  ${blocked.length}`)
console.log(`Warn-severity findings:   ${warned.length}`)

const ruleCounts = new Map<string, number>()
for (const f of findings) ruleCounts.set(f.rule.id, (ruleCounts.get(f.rule.id) ?? 0) + 1)
const topRules = [...ruleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log(`\nTop rules triggered:`)
for (const [rule, count] of topRules) console.log(`  ${count.toString().padStart(4)}  ${rule}`)

const categoryCounts = new Map<Category, number>()
for (const f of findings) categoryCounts.set(f.rule.category, (categoryCounts.get(f.rule.category) ?? 0) + 1)
console.log(`\nBy category:`)
for (const [cat, count] of [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(4)}  ${cat}`)
}

if (failOnBlock && blocked.length > 0) {
  console.error(`\nfailing: ${blocked.length} block-severity finding(s)`)
  process.exit(1)
}
process.exit(0)
