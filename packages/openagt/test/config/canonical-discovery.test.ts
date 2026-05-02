import { beforeEach, describe, expect, test } from "bun:test"
import {
  _resetWarnedForTest,
  _warnedKeysForTest,
  warnDeprecatedConfigDir,
} from "../../src/config/canonical-discovery"

// A7: collapses .opencode/ singular/plural discovery onto a canonical name
// while still discovering the deprecated form. The warning fires once per
// (canonical, deprecated) pair per process — not once per file — so a load
// run that sweeps 50 files under .opencode/agents/ produces one log line.

beforeEach(() => {
  _resetWarnedForTest()
})

describe("config canonical-discovery", () => {
  test("no warning when matched path is under the canonical dir", () => {
    warnDeprecatedConfigDir("agent", "agents", "/abs/.opencode/agent/foo.md")
    expect(_warnedKeysForTest()).toEqual([])
  })

  test("records one warning when matched path is under the deprecated dir (POSIX path)", () => {
    warnDeprecatedConfigDir("agent", "agents", "/abs/project/.opencode/agents/foo.md")
    expect(_warnedKeysForTest()).toEqual(["agents->agent"])
  })

  test("records one warning when matched path is under the deprecated dir (Windows path)", () => {
    warnDeprecatedConfigDir("agent", "agents", "C:\\proj\\.opencode\\agents\\foo.md")
    expect(_warnedKeysForTest()).toEqual(["agents->agent"])
  })

  test("repeated calls for the same (canonical, deprecated) pair do not duplicate the warning", () => {
    warnDeprecatedConfigDir("agent", "agents", "/abs/.opencode/agents/foo.md")
    warnDeprecatedConfigDir("agent", "agents", "/abs/.opencode/agents/bar.md")
    warnDeprecatedConfigDir("agent", "agents", "/abs/.opencode/agents/baz.md")
    expect(_warnedKeysForTest()).toEqual(["agents->agent"])
  })

  test("different (canonical, deprecated) pairs each get their own warning", () => {
    warnDeprecatedConfigDir("agent", "agents", "/abs/.opencode/agents/a.md")
    warnDeprecatedConfigDir("command", "commands", "/abs/.opencode/commands/c.md")
    warnDeprecatedConfigDir("skills", "skill", "/abs/.opencode/skill/SKILL.md")
    expect(_warnedKeysForTest().toSorted()).toEqual(["agents->agent", "commands->command", "skill->skills"])
  })

  test("partial substring match does not trigger (deprecated must be a path segment)", () => {
    // A path like /abs/.opencode/agentschema/foo.md contains "agents" as a
    // substring but not as a path segment — the warning must not fire on
    // that, only on a real `.opencode/agents/` directory.
    warnDeprecatedConfigDir("agent", "agents", "/abs/.opencode/agentschema/foo.md")
    expect(_warnedKeysForTest()).toEqual([])
  })
})
