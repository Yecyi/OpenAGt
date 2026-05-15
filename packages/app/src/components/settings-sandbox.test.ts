import { describe, expect, test } from "bun:test"
import {
  defaultOnBlockerLabels,
  defaultOnCandidateLabel,
  defaultOnRecommendation,
} from "./settings-sandbox-helpers"
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

  test("summarizes default-on candidate state", () => {
    expect(
      defaultOnCandidateLabel({
        ready_for_default_on: false,
        default_on_blockers: ["acl_apply_not_enabled"],
      } as Pick<SandboxStatus, "ready_for_default_on" | "default_on_blockers">),
    ).toBe("Eligible for Apply mode")
    expect(
      defaultOnCandidateLabel({
        ready_for_default_on: true,
        default_on_blockers: [],
      } as Pick<SandboxStatus, "ready_for_default_on" | "default_on_blockers">),
    ).toBe("Eligible for default-on")
  })

  test("recommends the next default-on evidence action", () => {
    expect(
      defaultOnRecommendation({
        default_on_enabled: false,
        ready_for_default_on: false,
        default_on_blockers: ["admin_gate_missing_or_stale"],
        next_action: { kind: "none", label: "Backend ready" },
      } as Pick<SandboxStatus, "default_on_enabled" | "ready_for_default_on" | "default_on_blockers" | "next_action">),
    ).toEqual({
      label: "Run the admin verification gate from an elevated repo terminal.",
      command: "bun run verify:windows-sandbox-admin",
    })
  })
})
