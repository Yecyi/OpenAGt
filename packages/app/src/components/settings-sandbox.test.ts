import { describe, expect, test } from "bun:test"
import { defaultOnBlockerLabels, defaultOnCandidateLabel, defaultOnRecommendation } from "./settings-sandbox-helpers"
import type { SandboxStatus } from "@openagt/sdk/v2/client"

function sandboxConfig(networkPolicy: SandboxStatus["config"]["network_policy"]) {
  return {
    enabled: true,
    backend: "auto",
    failure_policy: "closed",
    report_only: false,
    broker_idle_ttl_ms: 30_000,
    windows_acl_apply_mode: "apply",
    network_policy: networkPolicy,
  } satisfies SandboxStatus["config"]
}

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
    expect(
      defaultOnBlockerLabels({
        default_on_blockers: ["network_loopback_not_enforced"],
      } as Pick<SandboxStatus, "default_on_blockers">),
    ).toEqual(["network_policy=loopback is not enforced"])
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
        config: sandboxConfig("none"),
        next_action: { kind: "none", label: "Backend ready" },
      } as Pick<
        SandboxStatus,
        "default_on_enabled" | "ready_for_default_on" | "default_on_blockers" | "next_action" | "config"
      >),
    ).toEqual({
      label: "Run the admin verification gate from an elevated repo terminal.",
      command: "bun run verify:windows-sandbox-admin -- --policy none",
    })
    expect(
      defaultOnRecommendation({
        default_on_enabled: false,
        ready_for_default_on: false,
        default_on_blockers: ["admin_gate_missing_or_stale"],
        config: sandboxConfig("loopback"),
        next_action: { kind: "none", label: "Backend ready" },
      } as Pick<
        SandboxStatus,
        "default_on_enabled" | "ready_for_default_on" | "default_on_blockers" | "next_action" | "config"
      >),
    ).toEqual({
      label: "Run the admin verification gate from an elevated repo terminal.",
      command: "bun run verify:windows-sandbox-admin -- --policy loopback",
    })
  })

  test("recommends active default-on when the config path is enabled", () => {
    expect(
      defaultOnRecommendation({
        default_on_enabled: true,
        ready_for_default_on: true,
        default_on_blockers: [],
        config: sandboxConfig("none"),
        next_action: { kind: "none", label: "Backend ready" },
      } as Pick<
        SandboxStatus,
        "default_on_enabled" | "ready_for_default_on" | "default_on_blockers" | "next_action" | "config"
      >),
    ).toEqual({
      label: "Default-on native sandbox is active for new sandbox brokers.",
    })
  })
})
