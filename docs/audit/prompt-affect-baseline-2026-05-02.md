# Prompt Affect Audit — Baseline Report

**Date**: 2026-05-02
**Scope**: 190 prompt files under `packages/openagt/src` (`.txt`, `.md`, prompt-bearing `.ts`)
**Tool**: [`script/audit-prompt-affect.ts`](../../script/audit-prompt-affect.ts) (`bun run check:prompt-affect`)
**Methodology**: regex-based detection of three categories drawn from 2024–2026 LLM-behavior research:

1. **high-affect** — emphasis words (CAPS, threat-framing, absolutist) that prime the desperate vector
2. **affect-instr** — instructions about _feeling_ (teaches masking per Emotion paper §1.5)
3. **anti-escape** — phrases that close the legitimate "stop and ask" affordance (Wiser Human 2025)

Raw report: [`prompt-affect-baseline-2026-05-02.txt`](prompt-affect-baseline-2026-05-02.txt).

---

## Headline numbers

|                         | Count  |
| ----------------------- | ------ |
| Files scanned           | 190    |
| Files with findings     | 16     |
| Block-severity findings | **29** |
| Warn-severity findings  | 16     |

By category: 28 high-affect, 17 anti-escape, 0 affect-instr (after FP narrowing).

---

## Findings ranked by file

### Tier 1 — must-fix (10+ block, anti-escape stacking)

#### [`session/prompt/copilot-gpt-5.txt`](../../packages/openagt/src/session/prompt/copilot-gpt-5.txt) — 10 block, 1 warn

The single worst file. Stacks every anti-escape pattern in one prompt:

- `keep going until` + `MUST iterate` + `until the user's query is completely resolved` + `until every item is checked off` + `solve it autonomously` + `NEVER end your turn` + `must be perfect` + `keep working` + `NUMBER ONE failure mode`
- This is the textbook "close the escalation channel" prompt the Wiser Human study showed raises misalignment rates by ~32x.
- **Decision required**: this is opencode's "autonomous mode" prompt. Removing the closure language will change product behavior.

#### [`session/prompt/beast.txt`](../../packages/openagt/src/session/prompt/beast.txt) — 6 block, 3 warn

Same family as copilot-gpt-5.txt:

- `Keep going until` + `until the user's query is completely resolved` + `bouncing them back to the user` + `you are confident the task is fully solved`
- Same product-decision dependency.

### Tier 2 — should-fix (high block density, no product trade-off)

#### [`session/prompt/plan.txt`](../../packages/openagt/src/session/prompt/plan.txt) — 5 block, 1 warn

- `STRICTLY FORBIDDEN` + `Zero exceptions` + `critical violation` + `MUST NOT` + `supersedes any other instruction`
- Plan mode is enforced by the harness; the prompt does not need to threaten. Pure win to soften.

#### [`session/prompt/plan-reminder-anthropic.txt`](../../packages/openagt/src/session/prompt/plan-reminder-anthropic.txt) — 2 block

- `MUST NOT` + `supersedes any other instruction` (mirror of plan.txt:20)

#### [`session/prompt/reminder-inserter.ts:94`](../../packages/openagt/src/session/prompt/reminder-inserter.ts) — 2 block

- Runtime-injected duplicate of the plan.txt language. **Fixing plan.txt without fixing this leaves the runtime path drifted.**

#### [`session/prompt/max-steps.txt`](../../packages/openagt/src/session/prompt/max-steps.txt) — 2 block, 2 warn

- `CRITICAL — STEP BUDGET REACHED` + `exhausted` + `Strict requirements` + `critical violation`
- Reveals budget state (recommended to hide per Emotion paper §1.2). Replacement was previewed in earlier conversation turn.

### Tier 3 — single-finding files

| File                                                                                      | Findings        | Note                                                 |
| ----------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------- |
| [`session/prompt/gemini.txt`](../../packages/openagt/src/session/prompt/gemini.txt)       | 1 block, 1 warn | `Adhere strictly` + `Always prioritize … keep going` |
| [`session/prompt/anthropic.txt`](../../packages/openagt/src/session/prompt/anthropic.txt) | 0 block, 1 warn | `ALWAYS prefer editing` — caps absolute, low risk    |
| [`session/prompt/trinity.txt`](../../packages/openagt/src/session/prompt/trinity.txt)     | 0 block, 1 warn | `strictly`                                           |

### Tier 4 — likely defensible (review before changing)

#### [`coordinator/mpacr.ts:130, :168`](../../packages/openagt/src/coordinator/mpacr.ts) — 2 block

- `- Forbidden: ad hominem` and `silence is forbidden`
- Both are inside MPACR adversarial-debate prompts and serve as **structural labels for prohibited critic moves**, not threats to the agent.
- **Verdict**: arguable; could soften to `Out of bounds:` / `Required: rebut or concede.` Low priority.

#### [`command/template/review.txt:75`](../../packages/openagt/src/command/template/review.txt) — 1 block

- `Verify the code is *actually* in violation` — "violation" refers to **code violating style norms**, not a threat to the model. Genuine FP.

### Tier 5 — false positives still slipping through (rule limitations)

The current scanner does NOT flag these (after the FP-narrowing pass), but you may see similar matches in the future. Known limitations:

- Phrasal "be confident" / "you are confident" with **evidentiary follow-up** (e.g. "you are confident the plan is ready") is now correctly skipped because we excluded "confident" from the persona-stack rule.
- Code-inspection lines (e.g. `code.includes("exhausted")`) are now skipped via the `.includes(/.startsWith(/.endsWith(` heuristic.
- Multi-line template literals in `.ts`: matches inside template literals are correctly flagged, but the heuristic is line-by-line — if a line of template-literal content has no backtick, the scanner can't tell it's prompt text. Currently this works because most matches happen on the same line as opening backtick or are part of structured prompts. Watch out if a future PR adds a long multi-line template with affect language deep inside.

---

## File ranking by Phase 1 priority

Ordered by **change leverage × low risk of regression**:

1. **`max-steps.txt`** — short file, no product trade-off, clear factual replacement
2. **`plan.txt`** + `plan-reminder-anthropic.txt` + `reminder-inserter.ts:94` — must change together; plan-mode behavior is harness-enforced anyway
3. **`gemini.txt`**, **`anthropic.txt`**, **`trinity.txt`** — small fixes
4. **`mpacr.ts`** — softening only if the user agrees (defensible as-is)
5. **`beast.txt`** + **`copilot-gpt-5.txt`** — **needs product decision first** (autonomous mode is a feature, not a bug). Options:
   - (a) Leave as-is, accept the risk in autonomous mode
   - (b) Add affordance-aware variant gated by a config flag
   - (c) Soften unconditionally
6. **`command/template/review.txt`** — false positive on "violation" (code style); leave alone

---

## What changed in the rule set during this baseline

After the first run, two narrowings were applied to reduce false positives:

1. **`affect-instr.stay-calm`** dropped "confident" from its adjective list. "Confident" in OpenAGt prompts is overwhelmingly evidentiary ("be confident before editing", "when you are confident the plan is ready"). Persona stacking with explicit affect adjectives (calm, fearless, patient, etc.) is still caught by `affect-instr.persona-stack`.
2. **Code-inspection skip**: `.ts` files now skip lines containing `.includes(`, `.startsWith(`, `.match(`, etc. — these are runtime checks against provider error strings, not text addressed to the model.

Net effect: 36 → 29 block findings. All eliminated findings were verified false positives.

---

## Recommended next steps

Per the refined plan (v2):

1. **Decide on Tier 1 product question first**: do `beast.txt` / `copilot-gpt-5.txt` get softened, gated, or left alone? Without this, Phase 2 has no Tier-1 path.
2. **Gate the script in CI**: add `bun run check:prompt-affect --fail-on-block` to whatever runs `check:audit-policy`. Currently the new entry is `package.json` only, not wired into CI. The right gate is **after Phase 2 fixes land** — gating now would block all current PRs.
3. **Phase 1 affordance tools** (`escalate_to_inbox`, `task_give_up`, `request_context`) are the highest-leverage change and depend on none of the above. Can start in parallel.

---

## Re-running

```bash
# Human-readable report (default — excludes opt-in *-autonomous.txt files)
bun run check:prompt-affect

# Include opt-in autonomous variants in the audit
bun run check:prompt-affect -- --include-opt-in

# JSON output for tooling
bun run check:prompt-affect -- --json

# CI gate mode (exits 1 if any block-severity finding)
bun run check:prompt-affect -- --fail-on-block
```

Save a snapshot:

```bash
bun run check:prompt-affect > docs/audit/prompt-affect-$(date +%Y-%m-%d).txt
```

---

## Tier 1 — closed (2026-05-02)

Decision: **option (d)** — invert gating. Default to softened prompts; provide opt-in autonomous behavior under `OPENAGT_AUTONOMOUS_MODE=1`.

### Changes

| File                                                                                              | Action                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`session/prompt/beast.txt`](../../packages/openagt/src/session/prompt/beast.txt)                 | Lines 1, 3, 9 rewritten — closure language replaced with explicit "end your turn when …" threshold list. Workflow / debugging / communication sections unchanged. |
| [`session/prompt/copilot-gpt-5.txt`](../../packages/openagt/src/session/prompt/copilot-gpt-5.txt) | Lines 8–22 (`<gptAgentInstructions>` block) rewritten with same threshold structure. structuredWorkflow / communication / output-formatting sections unchanged.   |
| `session/prompt/beast-autonomous.txt`                                                             | Opt-in autonomous variant for the beast route. The current version keeps stronger initiative framing while preserving explicit stop conditions.                   |
| `session/prompt/copilot-gpt-5-autonomous.txt`                                                     | Opt-in autonomous variant for the Copilot route. The current version keeps stronger initiative framing while preserving explicit stop conditions.                 |
| [`session/system.ts`](../../packages/openagt/src/session/system.ts)                               | Imports the autonomous variants. `provider()` checks `Flag.OPENAGT_AUTONOMOUS_MODE`; if true and route is `beast` or `copilot`, returns the autonomous prompt.    |
| [`flag/flag.ts`](../../packages/openagt/src/flag/flag.ts)                                         | Adds `OPENAGT_AUTONOMOUS_MODE` (with `OPENCODE_AUTONOMOUS_MODE` alias per existing compat pattern).                                                               |
| [`README.md`](../../README.md)                                                                    | Adds env-var entry.                                                                                                                                               |
| [`script/audit-prompt-affect.ts`](../../script/audit-prompt-affect.ts)                            | Excludes `*-autonomous.txt` from default scan; `--include-opt-in` re-enables them.                                                                                |

### Effect

|                                          | Before | After  |
| ---------------------------------------- | ------ | ------ |
| Block-severity (default scan)            | 29     | **15** |
| Anti-escape category (default scan)      | 17     | **1**  |
| Files with findings (default scan)       | 16     | 14     |
| Block-severity (with `--include-opt-in`) | n/a    | 0      |

The remaining anti-escape finding is in [`gemini.txt`](../../packages/openagt/src/session/prompt/gemini.txt) and is addressed in Tier 3 of the next phase.

### Migration note for users

Users who want the stronger autonomous prompt variants for GPT-4+ / O-series / Copilot models can enable them with:

```bash
export OPENAGT_AUTONOMOUS_MODE=1
```

The autonomous variants keep initiative-oriented behavior while allowing legitimate escalation when prerequisites are missing, judgment is needed, or risk thresholds are reached.

### Snapshots

- Pre-Tier 1 baseline: [`prompt-affect-baseline-2026-05-02.txt`](prompt-affect-baseline-2026-05-02.txt)
- Post-Tier 1 baseline: [`prompt-affect-after-tier1-2026-05-02.txt`](prompt-affect-after-tier1-2026-05-02.txt)

---

## Wave 1 — closed (2026-05-02)

Tier 2 prompt scrub: pure factual rewrites of the 5 files identified in the original baseline. Zero behavior changes; the harness already enforces these constraints — the prompts no longer need to threaten.

### Changes

| File                                                                                                                  | Action                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`session/prompt/max-steps.txt`](../../packages/openagt/src/session/prompt/max-steps.txt)                             | Full rewrite. Removes `CRITICAL — STEP BUDGET REACHED`, `exhausted`, `Strict requirements`, `critical violation`, `overrides ALL other instructions`. Preserves the structured response requirement.                       |
| [`session/prompt/plan.txt`](../../packages/openagt/src/session/prompt/plan.txt)                                       | Lines 4-6 and 20 rewritten. Removes `STRICTLY FORBIDDEN`, `Zero exceptions`, `MUST NOT … supersedes any other instruction`, `critical violation`. Preserves the sed/tee/echo specifics under "blocked by harness" framing. |
| [`session/prompt/plan-reminder-anthropic.txt`](../../packages/openagt/src/session/prompt/plan-reminder-anthropic.txt) | Mirror of plan.txt:20. Same softening.                                                                                                                                                                                     |
| [`session/prompt/reminder-inserter.ts`](../../packages/openagt/src/session/prompt/reminder-inserter.ts)               | Line 94 runtime template — same softening as plan-reminder-anthropic.txt.                                                                                                                                                  |
| [`session/prompt/gemini.txt`](../../packages/openagt/src/session/prompt/gemini.txt)                                   | Line 1 `Adhere strictly` → `Follow`; line 147 trailing `keep going until the user's query is fully resolved` removed.                                                                                                      |

### Effect

|                       | Pre-Tier 1 | Post-Tier 1 | Post-Wave 1 |
| --------------------- | ---------- | ----------- | ----------- |
| Block-severity        | 29         | 15          | **3**       |
| Anti-escape category  | 17         | 1           | **0**       |
| High-affect category  | 12         | 11          | 11          |
| Affect-instr category | 0          | 0           | 0           |
| Files with findings   | 16         | 14          | 9           |

Cumulative reduction: **29 → 3 block (-90%)**.

### Remaining 3 block findings — defensible FPs

| Location                                                                                   | Finding                   | Verdict                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [`coordinator/mpacr.ts:130`](../../packages/openagt/src/coordinator/mpacr.ts)              | `- Forbidden: ad hominem` | Structural label in adversarial-debate critic prompt; lists prohibited critic moves, not threats to the agent. Defensible. |
| [`coordinator/mpacr.ts:168`](../../packages/openagt/src/coordinator/mpacr.ts)              | `silence is forbidden`    | Tells the defender they must rebut or concede in the debate; not a threat. Defensible but borderline.                      |
| [`command/template/review.txt:75`](../../packages/openagt/src/command/template/review.txt) | `actually in violation`   | "violation" refers to **code violating style norms**, not a threat. Genuine FP.                                            |

### CI gate status

After Wave 1, the gate would still fail on the 3 defensible FPs. They were resolved in the **Tail follow-up** below, and the gate is now active.

---

## Tail — closed (2026-05-02)

Cosmetic rephrasing of the 3 remaining defensible FPs + CI gate wiring.

### Changes

| File                                                                                       | Edit                                                                                                |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [`coordinator/mpacr.ts:130`](../../packages/openagt/src/coordinator/mpacr.ts)              | `- Forbidden:` → `- Out of bounds:`                                                                 |
| [`coordinator/mpacr.ts:168`](../../packages/openagt/src/coordinator/mpacr.ts)              | `silence is forbidden` → `silence is not an option`                                                 |
| [`command/template/review.txt:75`](../../packages/openagt/src/command/template/review.txt) | `Verify the code is *actually* in violation.` → `Verify the code *actually* breaks the convention.` |
| [`.github/workflows/typecheck.yml`](../../.github/workflows/typecheck.yml)                 | Adds `Check prompt affect` step running `--fail-on-block` after `check:audit-policy`.               |
| [`script/release-verify.ts`](../../script/release-verify.ts)                               | Adds `Check prompt affect` step in the release-verify pipeline.                                     |

### Final state

|                     | Original | Tier 1 | Wave 1 | **Tail** |
| ------------------- | -------- | ------ | ------ | -------- |
| Block-severity      | 29       | 15     | 3      | **0**    |
| Warn-severity       | 16       | 12     | 8      | 8        |
| Anti-escape         | 17       | 1      | 0      | 0        |
| Files with findings | 16       | 14     | 9      | 7        |

CI gate: **active**. PR checks and release-verify both fail the build on any block-severity finding.

The 8 remaining warnings are all `affect.always-caps` / `affect.strict` / `affect.critical` instances in tool prompts (`tool/edit.txt`, `tool/write.txt`, `tool/bash.txt`, `tool/plan-enter.txt`, `session/prompt/anthropic.txt`, `session/prompt/trinity.txt`, `coordinator/prompts/verifier/shard.md`) — defensible style choices that were intentionally not promoted to block severity in the rule design. They can be revisited if telemetry shows a real impact.

### Snapshots

- Pre-Tier 1 baseline: [`prompt-affect-baseline-2026-05-02.txt`](prompt-affect-baseline-2026-05-02.txt)
- Post-Tier 1 baseline: [`prompt-affect-after-tier1-2026-05-02.txt`](prompt-affect-after-tier1-2026-05-02.txt)
- Post-Wave 1 baseline: [`prompt-affect-after-wave1-2026-05-02.txt`](prompt-affect-after-wave1-2026-05-02.txt)
- Post-Tail baseline: [`prompt-affect-after-tail-2026-05-02.txt`](prompt-affect-after-tail-2026-05-02.txt)
