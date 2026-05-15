import { describe, expect, test } from "bun:test"
import { defaultOnBlockerLabels } from "./settings-sandbox-helpers"
import type { SandboxStatus } from "@openagt/sdk/v2/client"

describe("settings sandbox helpers", () => {
  test("labels default-on blockers for the settings status panel", () => {
    expect(
      defaultOnBlockerLabels({
        default_on_blockers: ["admin_gate_missing_or_stale", "acl_apply_not_enabled", "network_none_not_enforced"],
      } as Pick<SandboxStatus, "default_on_blockers">),
    ).toEqual([
      "Admin gate report is missing or stale",
      "ACL apply mode is not enabled",
      "network_policy=none is not enforced",
    ])
  })

  test("passes through unknown blocker ids so new server reasons stay visible", () => {
    expect(
      defaultOnBlockerLabels({
        default_on_blockers: ["future_blocker"],
      } as Pick<SandboxStatus, "default_on_blockers">),
    ).toEqual(["future_blocker"])
  })
})
