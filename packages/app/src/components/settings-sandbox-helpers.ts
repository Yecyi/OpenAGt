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
    return item
  })
}
