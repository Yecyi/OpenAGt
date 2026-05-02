// Wave 10 Step 4: regression guard for the Phase 5 verbatim invariant
// extended to the new replyToInboxItem path.
//
// Locks two contracts in source:
//
//   1. personal/inbox-ops.ts replyToInboxItem must merge `user_reply` into
//      payload byte-for-byte. No paraphrase, no template wrap, no
//      sanitize. Same shape escalate_to_inbox already obeys for the goal
//      field.
//   2. cli/cmd/inbox.ts InboxResolveCommand must hand args.reply to
//      svc.replyToInboxItem({ id, reply }) directly. No string operation
//      between the user's CLI input and the ops layer.
//
// Source-level inspection (no runtime mock): the personal/coordinator
// circular-import cycle that broke CI in commit 9bc432120 makes runtime
// mocks expensive. Source inspection gives the same regression guard
// with zero test-runtime overhead. See
// docs/audit/auto-synth-text-2026-05-02.md for the Phase 5 rationale.

import { describe, expect, test } from "bun:test"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir, "..", "..")

describe("personal.replyToInboxItem — Phase 5 verbatim preservation", () => {
  test("inbox-ops.ts merges input.reply directly into payload.user_reply", async () => {
    const source = await Bun.file(path.join(ROOT, "src/personal/inbox-ops.ts")).text()

    // The merge happens via spread + literal assignment. No transform.
    expect(source).toContain("user_reply: input.reply,")

    // Companion timestamp; Date.now() not now() so we don't drift if `now`
    // gets monkeypatched. Either path is acceptable — assert the field exists.
    expect(source).toMatch(/replied_at:\s*(?:timestamp|Date\.now\(\)|now\(\))/)

    // No paraphrase / sanitize / template wrap on input.reply. If a future
    // contributor adds something like `user_reply: sanitize(input.reply)`
    // or `user_reply: \`User said: \${input.reply}\``, this test fails.
    expect(source).not.toMatch(/user_reply:\s*\w+\s*\(\s*input\.reply/)
    expect(source).not.toMatch(/user_reply:\s*`[^`]*\$\{input\.reply\}[^`]*`/)
  })

  test("CLI InboxResolveCommand hands args.reply to replyToInboxItem unchanged", async () => {
    const source = await Bun.file(path.join(ROOT, "src/cli/cmd/inbox.ts")).text()

    // CLI calls replyToInboxItem with the reply string from args directly.
    expect(source).toContain("replyToInboxItem({ id, reply: args.reply as string })")

    // No processing of args.reply between yargs and the service call (e.g.
    // .trim(), .toLowerCase(), template wrap, JSON.stringify).
    expect(source).not.toMatch(/args\.reply\.\w+\(/)
    expect(source).not.toMatch(/reply:\s*`[^`]*\$\{args\.reply\}[^`]*`/)
  })
})
