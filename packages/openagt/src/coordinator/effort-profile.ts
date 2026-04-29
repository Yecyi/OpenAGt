// Coordinator effort profile presets.
// This file maps effort levels to profile contracts; it does not build plan graphs.

import { EffortProfile, type EffortLevel as EffortLevelType, type EffortProfile as EffortProfileType } from "./schema"

export function effortProfileFor(effort: EffortLevelType): EffortProfileType {
  return EffortProfile.parse(
    effort === "low"
      ? {
          planning_rounds: 1,
          expert_count_min: 1,
          expert_count_max: 1,
          verifier_count_min: 0,
          reducer_enabled: false,
          reviewer_enabled: false,
          debugger_enabled: false,
          revise_policy: "none",
          max_revise_nodes: 0,
          max_revision_per_artifact: 0,
          reasoning_effort: "low",
          timeout_multiplier: 0.75,
        }
      : effort === "high"
        ? {
            planning_rounds: 2,
            expert_count_min: 2,
            expert_count_max: 4,
            verifier_count_min: 1,
            reducer_enabled: true,
            reviewer_enabled: true,
            debugger_enabled: false,
            revise_policy: "critical_only",
            max_revise_nodes: 6,
            max_revision_per_artifact: 1,
            reasoning_effort: "high",
            timeout_multiplier: 1.5,
          }
        : effort === "deep"
          ? {
              planning_rounds: 3,
              expert_count_min: 3,
              expert_count_max: 6,
              verifier_count_min: 2,
              reducer_enabled: true,
              reviewer_enabled: true,
              debugger_enabled: true,
              revise_policy: "all_artifacts",
              max_revise_nodes: 24,
              max_revision_per_artifact: 2,
              reasoning_effort: "high",
              timeout_multiplier: 3,
            }
          : {
              planning_rounds: 1,
              expert_count_min: 1,
              expert_count_max: 2,
              verifier_count_min: 1,
              reducer_enabled: false,
              reviewer_enabled: true,
              debugger_enabled: false,
              revise_policy: "critical_only",
              max_revise_nodes: 1,
              max_revision_per_artifact: 1,
              reasoning_effort: "medium",
              timeout_multiplier: 1,
            },
  )
}
