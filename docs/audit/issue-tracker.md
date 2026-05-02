# Analysis-doc finding tracker

This file is the index of every actionable finding raised in a `docs/` analysis report or session transcript. New analyses append rows here instead of creating a sixth, seventh, eighth standalone analysis doc that re-discovers the same debts.

## How to use

- **Reading**: each row tells you a finding, where it lives, and whether it's been closed.
- **Adding a finding**: append a row in the matching analysis section below. Use a stable ID like `apr.4.5` (April §4.5) or `may.A1` (May session, A1 step).
- **Closing**: change the status to `closed`, fill in the closing commit (short sha + subject). Keep the row — don't delete it.
- **Wontfix**: change the status to `wontfix`, give a one-sentence reason in the Notes column.

## Legend

- `open` — finding stands; no fix in tree
- `closed` — fix is merged
- `wontfix` — explicit decision not to fix; reason in Notes

---

## Source: docs/OPENAGT_DEEP_ANALYSIS_AND_VNEXT_GUIDE_2026-04.md (2026-04-30)

| ID | Finding | File:line at time of finding | Status | Closing commit / Notes |
|---|---|---|---|---|
| apr.4.1 | `environmentMemo` uses fixed key `"environment"` and date-only hash, so multi-model / multi-workspace processes share the cached static prompt block | `packages/openagt/src/session/system.ts:230-263` | closed | `9bbfbf49f Wave 11 Step A1` — memoKey now partitions by `${providerID}:${api.id}:${directory}:${worktree}:${vcs}:${platform}` |
| apr.4.2 | Bus event persistence writes to global `events.jsonl` without instance/workspace partitioning | `packages/openagt/src/bus/index.ts` | open | Not addressed in Wave 11. Phase B Stream 3 candidate. |
| apr.4.3 | Bus persistence whitelist has `"tools.changed"` but MCP emits `"mcp.tools.changed"`; events silently dropped | `packages/openagt/src/bus/index.ts:21` vs `packages/openagt/src/mcp/events.ts:9` | closed | `68744cef2 Wave 11 Step A2` — whitelist renamed; `isCriticalEventType` exported and pinned via test/bus/critical-events.test.ts |
| apr.4.4 | `dangerous-command-detector` is defined but not in the bash execution main path; verdicts diverge between intended and actual safety | `packages/openagt/src/security/dangerous-command-detector.ts`, `tool/bash-execution-plan.ts`, `tool/bash.ts` | open | Larger refactor; Phase B Stream 3 candidate per the 2026-05-02 plan. |
| apr.4.5 | `computeBackoff()` defined in fallback-service.ts but never called — chain rotates at full speed under 429 storm | `packages/openagt/src/provider/fallback-service.ts:47` (definition; no callers) | closed | `dbd5027dc Wave 11 Step A3` — wired into `next()` when `state.attempts > 0` |
| apr.4.6 | Sandbox `writable_paths` advisory; `maxOutputBytes` defined but not enforced; cross-instance resource accounting global | `packages/openagt/src/sandbox/policy.ts`, `packages/openagt/src/sandbox/process-sandbox.ts` | open | Not addressed in Wave 11. Phase B Stream 3 candidate. |
| apr.4.7 | `canRun()` calls `list()` per invocation — sweep of K ready tasks costs O(K*N) storage reads | `packages/openagt/src/session/task-runtime.ts:215-246` | closed | `a972cfb63 Wave 11 Step A4` — canRun accepts optional tasks snapshot; dispatch-loop passes pre-fetched allTasks |
| apr.4.8 | Core `packages/openagt` package is too large; `"./*": "./src/*.ts"` export means internal modules are reachable as public API | `packages/openagt/package.json`, `packages/openagt/src/effect/app-runtime.ts` | open | Phase B Stream 4 (boundary trial) per the 2026-05-02 plan. |
| apr.5.x | PR CI is Ubuntu-only; focused tests exclude `test/cli/tui`; default build pulls `https://models.dev/api.json` (network); README references stale versions | `.github/workflows/typecheck.yml`, `packages/openagt/script/build.ts`, `packages/openagt/script/generate.ts`, `README.md` | partial | README/version-metadata closed via `4ce5887fa Wave 11 Step A5`. Cross-platform CI / generate.ts network dependency: Phase B Stream 3. |

---

## Source: 2026-05-02 session analysis (no standalone doc)

The "深度分析这个项目的技术细节，并且点出 What went well, even better if" session of 2026-05-02 added a few items beyond the April set. Recorded here so they survive the conversation.

| ID | Finding | File:line at time of finding | Status | Closing commit / Notes |
|---|---|---|---|---|
| may.tdz | `personal/service.ts:1-13` documents a structural TDZ trap that any new tool implementation can re-introduce; only defense is a comment | `packages/openagt/src/personal/service.ts:1-13`, `packages/openagt/src/tool/registry.ts:6-18` | closed | `fd06b23c7 Wave 11 Step A8` — `bun run check:tool-imports` rejects new `personal/personal` / `coordinator/coordinator` value imports from tool/*.ts |
| may.readme | README references v1.16.0 stable + v1.17.0-rc.3 RC; actual stable is v1.20.2, current minor is v1.21.0; `package.json:23` aliases `verify:v1.17` to the v1.16 verifier | `README.md:68-74,111`, `package.json:23` | closed | `4ce5887fa Wave 11 Step A5` — README rewritten, `verify:v1.17` deleted, `verify:v1.21` + `script/v1.21-verify.ts` added |
| may.agents-md | AGENTS.md says default branch is `dev`; actual default is `main`; anyone following AGENTS.md to compute a diff base produces wrong diff | `AGENTS.md:3-4` | closed | `d12144119 Wave 11 Step A6` |
| may.opencode-discovery | `.opencode/{singular,plural}` dual discovery (agent/agents, command/commands, etc.); a user splitting files between forms sees neither | `packages/openagt/src/config/agent.ts:118,135,155`, `command.ts:29`, `expert.ts:75`, `plugin.ts:33`, `tool/registry.ts:167`, `skill/index.ts:23` | closed | `6dab33244 Wave 11 Step A7` — warn-only deprecation via `warnDeprecatedConfigDir`; hard removal v1.23 |
| may.beta-deps | Effect 4.0.0-beta.48, Drizzle 1.0.0-beta.19, ai SDK 6.0.168 are all on the critical path; Effect upgrade has unbounded blast radius across every Layer | `package.json` workspace catalog | open | Plan recommends a `docs/effect-upgrade-checklist.md` and a fixed monthly window — neither created in Phase A. |
| may.flutter-noise | `packages/openagt_flutter` and `packages/opencode_flutter` both ship in workspace despite README saying Flutter is "deferred"; eats CI / install / typecheck budget | `packages/openagt_flutter`, `packages/opencode_flutter`, `README.md:24,287` | open | Plan defers to v1.23 ("active port or move to archive/"). |
| may.analysis-proliferation | `docs/` already has 5 standalone analysis docs (`OPENAGT_DEEP_ANALYSIS_AND_VNEXT_GUIDE_2026-04.md` + 4 others); no shared index, so each rediscovers the same debts | `docs/*.md` | closed | this file. Future analyses must append rows here instead of creating a sixth standalone doc. |

---

## Source: incidental findings during Wave 11 implementation

Findings discovered while doing Phase A that were not in any analysis doc but are real and should be tracked.

| ID | Finding | File:line at time of finding | Status | Closing commit / Notes |
|---|---|---|---|---|
| inc.kind-migration | `personal_memory_note.kind` column added to schema in Wave 5 (`personal/schema.ts:95`, `personal/personal.sql.ts:14`) but no migration ships under `packages/openagt/migration/`. Tests and any deployed instance with an older DB hit `SQLiteError: table personal_memory_note has no column named kind` on memory writes | `packages/openagt/src/personal/personal.ts:119` (the failing call site), `packages/openagt/src/personal/personal.sql.ts:14` (the schema column) | open | Detected during Wave 11 Step A4 verification (`bun test test/agent/coordinator-personal.test.ts` reproduces). Needs a `2026050x_personal_memory_note_kind` migration adding `kind text not null default 'belief'` and the `personal_memory_kind_idx` index. Phase B Stream 1 dependency. |

---

## Releasing this file

When opening a release notes PR, scan this file for `closed` rows whose closing commit is in the release range and surface the corresponding April / May reference in the release notes' "Hazards / debts closed" section. Don't restate the finding; just link to this index by ID (e.g. `apr.4.1`).
