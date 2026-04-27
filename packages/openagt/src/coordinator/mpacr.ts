// MPACR — Multi-Perspective Adversarial Critical Review.
//
// Replaces the single-pass reviser with a four-stage structured debate:
//   1. Steel-man      — restate the artifact's strongest reading
//   2. Red-team       — K parallel critics attack the steel-manned argument
//   3. Defense        — owner rebuts or concedes each critique
//   4. Synthesis      — produce CriticalReviewVerdict with constructive feedback
//   5. Calibration    — record posterior + Brier feedback for long-term tuning
//
// This module is dispatch-agnostic. It only constructs the node graph; the
// actual parallel execution reuses parallelResearchStage/synthesisReducer
// patterns in coordinator.ts. See plan: Stream A in
// `.claude/plans/potencial-harzard-replicated-ullman.md`.

import { Context, Effect, Layer } from "effect"
import {
  CoordinatorNode,
  type CoordinatorNode as CoordinatorNodeType,
  type CoordinatorNodeInput,
  type EffortLevel as EffortLevelType,
  type EffortProfile as EffortProfileType,
  type TaskType as TaskTypeType,
} from "./schema"

// Predefined adversarial perspectives. Each critic is dispatched with a
// distinct lens so the debate covers complementary failure modes rather
// than redundant copies of the same critique.
export const CRITIC_PERSPECTIVES = [
  "factuality",
  "coherence",
  "risk",
  "domain_expertise",
  "user_value",
] as const
export type CriticPerspective = (typeof CRITIC_PERSPECTIVES)[number]

export interface MpacrInput {
  readonly idPrefix: string
  readonly target: CoordinatorNodeType
  readonly goal: string
  readonly workflow: TaskTypeType
  readonly effort: EffortLevelType
  readonly profile: EffortProfileType
  readonly dependsOn: readonly string[]
}

export interface MpacrOutput {
  readonly steelMan: CoordinatorNodeType
  readonly critics: readonly CoordinatorNodeType[]
  readonly defender: CoordinatorNodeType
  readonly synthesis: CoordinatorNodeType
  readonly calibrator: CoordinatorNodeType
  readonly all: readonly CoordinatorNodeType[]
  // A.5 partial-failure quorum: synthesis tolerates K - quorum critic skips.
  // Coordinator wiring should treat the synthesis node as runnable once
  // (criticsCompleted - criticsSkipped) >= quorum. Below quorum, the
  // synthesis node is allowed to run but the prompt instructs it to escalate
  // to verdict: "ask_user".
  readonly quorum: number
}

const PARALLEL_GROUP = "mpacr-red-team"

function makeNode(input: Omit<CoordinatorNodeInput, "priority" | "origin"> & Partial<Pick<CoordinatorNodeInput, "priority" | "origin">>) {
  return CoordinatorNode.parse({
    priority: "normal",
    origin: "coordinator",
    ...input,
  })
}

function expertID(workflow: TaskTypeType, role: string) {
  return `${workflow}.${role}`.replace(/[^a-z0-9.-]/gi, "-").toLowerCase()
}

function steelManNode(input: MpacrInput): CoordinatorNodeType {
  const id = `${input.idPrefix}:steel_man`
  return makeNode({
    id,
    description: `Steel-man the artifact ${input.target.id}`,
    prompt: [
      `Restate the strongest possible version of the artifact's argument.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      `Target node: ${input.target.id}`,
      ``,
      `You may not weaken the position. Quote supporting evidence verbatim.`,
      `Output fields: central_claim, supporting_evidence, best_case_scenario, charitable_assumptions.`,
    ].join("\n"),
    task_kind: "verify",
    subagent_type: "general",
    role: "steel-manner",
    risk: "low",
    depends_on: [...input.dependsOn],
    write_scope: [],
    read_scope: input.target.read_scope,
    acceptance_checks: ["Strongest reading articulated", "Charitable assumptions enumerated"],
    output_schema: "review",
    requires_user_input: false,
    expert_id: expertID(input.workflow, "steel-manner"),
    expert_role: "steel-manner",
    workflow: input.workflow,
    artifact_type: "review",
    artifact_id: `${id}:output`,
    memory_namespace: `${input.workflow}:steel-manner`,
  })
}

function criticNode(input: MpacrInput, perspective: CriticPerspective, idx: number, steelManId: string): CoordinatorNodeType {
  const id = `${input.idPrefix}:critic_${idx}_${perspective}`
  return makeNode({
    id,
    description: `Adversarial critic (${perspective})`,
    prompt: [
      `Critique the steel-manned argument from the ${perspective} perspective.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      `Target node: ${input.target.id}`,
      ``,
      `Constraints:`,
      `- You may NOT attack a weaker reading than the steel-manned one.`,
      `- For EACH attack, quote the steel-manned claim verbatim.`,
      `- For EACH attack, list evidence_for (your view) AND evidence_against (counter-evidence).`,
      `- Forbidden: ad hominem, vague "might be wrong", attacks on already-conceded points.`,
      ``,
      `Output: CriticalReviewVerdict with verdict, evidence_for, evidence_against, required_changes, confidence, and posterior in [0,1].`,
    ].join("\n"),
    task_kind: "verify",
    subagent_type: "general",
    role: "red-team-critic",
    risk: "low",
    depends_on: [steelManId],
    write_scope: [],
    read_scope: input.target.read_scope,
    parallel_group: PARALLEL_GROUP,
    acceptance_checks: [
      `Attacks grounded in steel-manned claims`,
      `Both evidence_for and evidence_against populated`,
    ],
    output_schema: "revise",
    requires_user_input: false,
    expert_id: expertID(input.workflow, `red-team-${perspective}`),
    expert_role: `red-team-critic-${perspective}`,
    workflow: input.workflow,
    artifact_type: "revise",
    artifact_id: `${id}:output`,
    memory_namespace: `${input.workflow}:red-team:${perspective}`,
  })
}

function defenderNode(input: MpacrInput, criticIds: readonly string[], steelManId: string): CoordinatorNodeType {
  const id = `${input.idPrefix}:defense`
  return makeNode({
    id,
    description: `Defense / concession round for ${input.target.id}`,
    prompt: [
      `Respond to each critique. For every critic finding you must EITHER`,
      `rebut with new evidence OR concede the point — silence is forbidden.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      `Target node: ${input.target.id}`,
      ``,
      `Output fields:`,
      `- rebuttals: [{ critique_id, rebuttal_text, evidence }]`,
      `- concessions: [{ critique_id, concession_text, scope_of_concession }]`,
      `- requested_information: critiques that need more data before judgment`,
    ].join("\n"),
    task_kind: "verify",
    subagent_type: "general",
    role: "defender",
    risk: "low",
    depends_on: [steelManId, ...criticIds],
    write_scope: [],
    read_scope: input.target.read_scope,
    acceptance_checks: ["Every critique addressed (rebut or concede)", "Concessions have explicit scope"],
    output_schema: "review",
    requires_user_input: false,
    expert_id: expertID(input.workflow, "defender"),
    expert_role: "defender",
    workflow: input.workflow,
    artifact_type: "review",
    artifact_id: `${id}:output`,
    memory_namespace: `${input.workflow}:defender`,
  })
}

function synthesisNode(
  input: MpacrInput,
  criticIds: readonly string[],
  defenderId: string,
  quorum: number,
): CoordinatorNodeType {
  const id = `${input.idPrefix}:synthesis`
  const artifactID = input.target.artifact_id ?? `${input.target.id}:artifact`
  return makeNode({
    id,
    description: `Synthesize verdict for ${input.target.id}`,
    prompt: [
      `Synthesize the debate into a single CriticalReviewVerdict.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      `Target node: ${input.target.id}`,
      ``,
      `Critics dispatched: ${criticIds.length}. Quorum required: ${quorum}.`,
      `Some critics may have returned verdict: "skipped" (timeout or error).`,
      `Treat skipped critics as missing evidence — do NOT count them against the artifact.`,
      `If fewer than ${quorum} critics produced substantive verdicts, return verdict:`,
      `"ask_user" with required_changes explaining the missing perspectives.`,
      ``,
      `Use the remaining critics' findings, the defender's responses, and the`,
      `steel-manned argument to produce constructive feedback. For every`,
      `required_change you must include both evidence_for and evidence_against —`,
      `no one-sided findings allowed.`,
      ``,
      `Verdict: pass | revise | retry | ask_user | stop. Posterior in [0,1].`,
      `Mark unresolved disagreements explicitly.`,
    ].join("\n"),
    task_kind: "verify",
    subagent_type: "general",
    role: "synth-reviser",
    risk: "low",
    depends_on: [defenderId, ...criticIds],
    write_scope: [],
    read_scope: input.target.read_scope,
    acceptance_checks: [
      "Verdict produced",
      "evidence_for and evidence_against populated for required_changes",
      `Skipped critics handled (quorum=${quorum})`,
    ],
    output_schema: "revise",
    requires_user_input: false,
    expert_id: expertID(input.workflow, "synth-reviser"),
    expert_role: "synth-reviser",
    workflow: input.workflow,
    artifact_type: "revise",
    artifact_id: `${id}:output`,
    revision_of: artifactID,
    quality_gate_id: id,
    memory_namespace: `${input.workflow}:synth-reviser`,
  })
}

// A.5: partial-failure quorum. Synthesis still emits a verdict if at least
// `quorum` of K critics returned valid output. Default 60% with a floor of 1
// so 2-critic runs require both, 3-critic runs require 2, 5-critic runs
// require 3, etc.
export function computeQuorum(criticCount: number): number {
  if (criticCount <= 1) return 1
  return Math.max(1, Math.ceil(criticCount * 0.6))
}

function calibratorNode(input: MpacrInput, synthesisId: string): CoordinatorNodeType {
  const id = `${input.idPrefix}:calibration`
  return makeNode({
    id,
    description: `Calibration record for synthesis verdict`,
    prompt: [
      `Record the synthesis verdict's posterior alongside the eventual outcome`,
      `signal so we can score reviewer calibration over time. Do not re-evaluate`,
      `the artifact — only emit the calibration record.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      ``,
      `Output: { expert_id, prior, posterior, outcome, brier_score }.`,
    ].join("\n"),
    task_kind: "generic",
    subagent_type: "general",
    role: "calibrator",
    risk: "low",
    depends_on: [synthesisId],
    write_scope: [],
    read_scope: [],
    acceptance_checks: ["Calibration record emitted"],
    output_schema: "summary",
    requires_user_input: false,
    expert_id: expertID(input.workflow, "calibrator"),
    expert_role: "calibrator",
    workflow: input.workflow,
    memory_namespace: `${input.workflow}:calibrator`,
  })
}

function pickPerspectives(count: number): readonly CriticPerspective[] {
  const k = Math.max(2, Math.min(6, Math.floor(count)))
  return CRITIC_PERSPECTIVES.slice(0, Math.min(k, CRITIC_PERSPECTIVES.length))
}

// Builds the full debate graph. Pure function; no side effects.
export function buildDebate(input: MpacrInput): MpacrOutput {
  const steelMan = steelManNode(input)
  const perspectives = pickPerspectives(input.profile.mpacr_critic_count)
  const critics = perspectives.map((p, i) => criticNode(input, p, i, steelMan.id))
  const quorum = computeQuorum(critics.length)
  const defender = defenderNode(input, critics.map((c) => c.id), steelMan.id)
  const synthesis = synthesisNode(input, critics.map((c) => c.id), defender.id, quorum)
  const calibrator = calibratorNode(input, synthesis.id)
  return {
    steelMan,
    critics,
    defender,
    synthesis,
    calibrator,
    quorum,
    all: [steelMan, ...critics, defender, synthesis, calibrator],
  }
}

// Degraded form for budget-pressured runs: K=1, no calibrator. Synthesis
// still runs so we still emit a structured verdict. Quorum is 1 — the lone
// critic must produce output or synthesis escalates.
export function buildDegraded(input: MpacrInput): MpacrOutput {
  const steelMan = steelManNode(input)
  const critic = criticNode(input, "factuality", 0, steelMan.id)
  const quorum = 1
  const defender = defenderNode(input, [critic.id], steelMan.id)
  const synthesis = synthesisNode(input, [critic.id], defender.id, quorum)
  // Calibrator omitted but we keep a placeholder summary node so callers can
  // still subscribe to a single terminal node id.
  return {
    steelMan,
    critics: [critic],
    defender,
    synthesis,
    calibrator: synthesis,
    quorum,
    all: [steelMan, critic, defender, synthesis],
  }
}

// Effect Service wrapper. Currently thin — exists so coordinator wiring (A.2)
// can swap in a stubbed planner during integration tests.
export interface Interface {
  readonly buildDebate: (input: MpacrInput) => Effect.Effect<MpacrOutput>
  readonly buildDegraded: (input: MpacrInput) => Effect.Effect<MpacrOutput>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/MpacrPlanner") {}

export const layer = Layer.succeed(Service, {
  buildDebate: (input: MpacrInput) => Effect.sync(() => buildDebate(input)),
  buildDegraded: (input: MpacrInput) => Effect.sync(() => buildDegraded(input)),
})
