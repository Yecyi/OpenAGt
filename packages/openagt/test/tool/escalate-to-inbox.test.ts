// Wave 9 Step 4: regression guard for the Phase 5 audit invariant —
// user-supplied text must pass verbatim through escalate_to_inbox to the
// underlying inbox `goal` field. No paraphrase, no LLM rewrite, no
// metadata-templated wrapper.
//
// We deliberately do NOT mount the full PersonalAgent.Service via Layer
// here. PersonalAgent's defaultLayer pulls in coordinator/coordinator.ts
// which has a circular import on Bus/TaskRuntime that hits a TDZ
// initialization error in the test runtime. The cost of resolving that
// circular for one test outweighs the value of a runtime mock.
//
// Instead this test does a source-level inspection: read the tool source,
// assert that the verbatim-preservation contract is structurally present
// in the code. If a future change adds a paraphrase step, the literal
// `goal: params.question` line will move and this assertion will fail.

import { describe, expect, test } from "bun:test"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir, "..", "..")

describe("tool.escalate_to_inbox — Phase 5 verbatim preservation", () => {
  test("source preserves the literal `goal: params.question` createInboxItem call", async () => {
    const source = await Bun.file(path.join(ROOT, "src/tool/escalate-to-inbox.ts")).text()

    // The createInboxItem call must use params.question directly as goal,
    // with no string operations, template literals, or function wraps.
    expect(source).toContain("goal: params.question,")

    // The `source: "agent"` tag is a Wave 5 invariant — agent-originated
    // inbox items must be tagged so audit consumers can distinguish them
    // from user/scheduled/webhook sources.
    expect(source).toMatch(/source:\s*"agent"/)

    // No paraphrase / sanitize / classifier helper between params and goal.
    // If someone adds something like `goal: sanitize(params.question)` this
    // test will fail and force a code-review checkpoint.
    expect(source).not.toMatch(/goal:\s*\w+\s*\(\s*params\.question/)
    expect(source).not.toMatch(/goal:\s*`[^`]*\$\{params\.question\}[^`]*`/)
  })

  test("task_give_up source preserves `recommend_next` and `partial_result` verbatim", async () => {
    const source = await Bun.file(path.join(ROOT, "src/tool/task-give-up.ts")).text()

    // task_give_up writes optional partial_result and recommend_next into
    // the inbox payload. Same verbatim invariant: no rewrite step.
    expect(source).toContain("payload.partial_result = params.partial_result")
    expect(source).toContain("payload.recommend_next = params.recommend_next")
    // source: "agent" tagging.
    expect(source).toMatch(/source:\s*"agent"/)
    // Reason is a categorical enum, not a free-text rewrite.
    expect(source).toContain("reason: params.reason")
  })
})
