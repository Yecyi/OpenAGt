- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

### Prompt files

Prompt content (system prompts, tool descriptions, dynamic prompt templates in `.ts`) is gated by `bun run check:prompt-affect` in CI. The lint blocks on three rule families derived from 2024–2026 LLM behavior research:

- **high-affect** — caps emphasis like `URGENT`, `CRITICAL`, `MUST NOT`, threat framing like `violation` / `forbidden`, and `supersedes any other instruction` (alignment-faking signal).
- **affect-instr** — instructions about *feeling* (`stay calm`, `do not panic`, `you are confident`) — these teach masking, not suppression, per the Anthropic emotion-concepts paper §1.5.
- **anti-escape** — phrases that close the legitimate "stop and ask" affordance (`keep going until`, `MUST iterate`, `solve it autonomously`) — Wiser Human (2025) shows closing this channel raises agentic-misalignment rates ~32×.

If a prompt needs to express a hard constraint, prefer factual harness-state language ("the harness rejects non-readonly tools this turn") over threats ("violation" / "MUST NOT"). The `escalate_to_inbox` and `task_give_up` tools are first-class options the model can use instead of pushing through; new prompts should not contradict that.

Audit invocation:

```bash
bun run check:prompt-affect                     # human-readable report
bun run check:prompt-affect -- --fail-on-block  # CI mode (exits 1 on any block)
bun run check:prompt-affect -- --include-opt-in # also scan *-autonomous.txt opt-in variants
```

Methodology, rule list, and per-wave history in `docs/audit/prompt-affect-baseline-2026-05-02.md`. Affordance-tool design in `docs/design/affordance-tools.md`.

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/openagt`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/openagt`), never `tsc` directly.

## Code Review & Bug-Fixing Workflow

When the user provides a bug report with exact file:line references, treat it as authoritative and verify each item against source before planning. Use a two-phase plan structure: Phase 1 for bug fixes, Phase 2 for improvements.

When TypeScript reports unusual syntax errors (e.g., spurious duplicate-key errors), inspect the actual file bytes with PowerShell hex tools (`Format-Hex`) — hidden unicode/BOM characters can corrupt parsing without appearing in normal diffs.
