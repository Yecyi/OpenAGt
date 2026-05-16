import type { SandboxStatus } from "@openagt/sdk/v2/client"

export function defaultOnBlockerLabels(status: Pick<SandboxStatus, "default_on_blockers">) {
  return status.default_on_blockers.map((item) => {
    if (item === "helper_missing") return "Windows helper is missing"
    if (item === "helper_version_mismatch") return "Helper protocol or version mismatch"
    if (item === "job_object_unavailable") return "Job Object containment unavailable"
    if (item === "wfp_setup_missing") return "WFP setup is missing"
    if (item === "admin_gate_missing_or_stale") return "Admin gate report is missing or stale"
    if (item === "filesystem_not_ready") return "Filesystem preflight is not ready"
    if (item === "acl_apply_not_enabled") return "ACL apply mode is not enabled"
    if (item === "acl_apply_not_verified") return "ACL apply mode has not verified enforcement"
    if (item === "network_none_not_enforced") return "network_policy=none is not enforced"
    if (item === "network_loopback_not_enforced") return "network_policy=loopback is not enforced"
    return item
  })
}

export function defaultOnCandidateLabel(status: Pick<SandboxStatus, "default_on_blockers" | "ready_for_default_on">) {
  if (status.ready_for_default_on) return "Eligible for default-on"
  if (status.default_on_blockers.filter((item) => !item.startsWith("acl_apply_")).length === 0) {
    return "Eligible for Apply mode"
  }
  return "Blocked"
}

export function defaultOnRecommendation(
  status: Pick<SandboxStatus, "default_on_enabled" | "ready_for_default_on" | "default_on_blockers" | "next_action">,
) {
  if (status.default_on_enabled) {
    return { label: "Default-on native sandbox is active for new sandbox brokers." }
  }
  if (status.ready_for_default_on) {
    return {
      label: "Ready for default-on candidate use. Select Auto backend, Closed failure policy, and Apply ACL mode.",
    }
  }
  if (status.default_on_blockers.includes("wfp_setup_missing")) {
    return {
      label: "Install Windows sandbox WFP setup from an elevated terminal.",
      command: "openagt sandbox windows setup --install --json",
    }
  }
  if (status.default_on_blockers.includes("admin_gate_missing_or_stale")) {
    return {
      label: "Run the admin verification gate from an elevated repo terminal.",
      command: "bun run verify:windows-sandbox-admin",
    }
  }
  if (
    status.default_on_blockers.includes("acl_apply_not_enabled") ||
    status.default_on_blockers.includes("acl_apply_not_verified")
  ) {
    return { label: "Switch Filesystem ACL mode to Apply after admin and WFP evidence are valid." }
  }
  return {
    label: status.next_action.label,
    command: status.next_action.command,
  }
}
