import { describe, expect, test } from "bun:test"
import {
  buildRegistry,
  pickVariantFromMap,
  readPromptDir,
  renderTemplate,
} from "../../src/coordinator/prompt-templates"
import path from "path"

// Snapshot tests for C.3 prompt extraction.
//
// Asserts that each extracted template, when rendered with the same variables
// the coordinator factories pass, produces the exact sequence of the approved
// externalized prompt snapshot. Any drift trips this test before a prompt
// change can land unnoticed.

const PROMPTS_DIR = path.join(import.meta.dirname, "../../src/coordinator/prompts")

function loadAll() {
  return buildRegistry(readPromptDir(PROMPTS_DIR))
}

function pick(role: string, variant: string) {
  const registry = loadAll()
  const template = pickVariantFromMap(registry, { role, forceVariant: variant })
  if (!template) throw new Error(`template not found: ${role}/${variant}`)
  return template
}

describe("Prompt-templates filesystem load", () => {
  test("loads all 5 known roles from coordinator/prompts/", () => {
    const registry = loadAll()
    expect(registry.has("reviser")).toBe(true)
    expect(registry.has("reviewer")).toBe(true)
    expect(registry.has("planner")).toBe(true)
    expect(registry.has("verifier")).toBe(true)
    expect(registry.has("reducer")).toBe(true)
  })

  test("reviser has both default and no-target variants", () => {
    const list = loadAll().get("reviser")!
    const variants = list.map((t) => t.variant).sort()
    expect(variants).toEqual(["default", "no-target"])
  })

  test("reducer has both default (research-synthesis) and project-deep-dive variants", () => {
    const list = loadAll().get("reducer")!
    const variants = list.map((t) => t.variant).sort()
    expect(variants).toEqual(["default", "project-deep-dive"])
  })
})

describe("Reviser default variant matches the approved snapshot", () => {
  test("renders to the exact string when target is set", () => {
    const template = pick("reviser", "default")
    const rendered = renderTemplate(template.content, {
      goal: "implement mission control backend",
      workflow: "coding",
      effort: "high",
      target_id: "implement",
      kind: "output_revise",
    })
    const expected = [
      `You are the reviser for the target artifact. Improve quality without exposing chain-of-thought; ship a verdict, not a monologue.`,
      ``,
      `**Mission inputs**`,
      `- Goal: implement mission control backend`,
      `- Workflow: coding`,
      `- Effort: high`,
      `- Target node: implement`,
      `- Revise kind: output_revise`,
      ``,
      `**Rules**`,
      `- Compare the artifact against the goal and the workflow's success criteria.`,
      `- Cite evidence (file paths, output, observed behavior) \u2014 never speculate.`,
      `- If the artifact is acceptable, set \`pass\` true and leave \`required_changes\` empty.`,
      `- If something is missing rather than wrong, prefer \`missing_context\` over \`required_changes\`.`,
      `- Pick exactly one \`action\`: \`proceed\` (ship as-is), \`retry\` (re-run the same node), \`revise\` (apply required_changes), \`ask_user\` (need user input), or \`handoff\` (escalate).`,
      ``,
      `**Output (JSON-like, all fields required)**`,
      `- \`pass\`: boolean \u2014 does the artifact meet the goal?`,
      `- \`issues\`: array of concrete problems with the artifact.`,
      `- \`missing_context\`: array of information needed but absent.`,
      `- \`required_changes\`: array of specific edits to make if \`pass\` is false.`,
      `- \`confidence\`: number in [0, 1].`,
      `- \`action\`: one of \`proceed | retry | revise | ask_user | handoff\`.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Reviser no-target variant matches the approved snapshot", () => {
  test("renders to reviseNode's filtered output when target is absent", () => {
    const template = pick("reviser", "no-target")
    const rendered = renderTemplate(template.content, {
      goal: "g",
      workflow: "coding",
      effort: "high",
      kind: "plan_revise",
    })
    const expected = [
      `You are the reviser for the in-flight artifacts. No specific target node was provided \u2014 assess the latest mission state holistically.`,
      ``,
      `**Mission inputs**`,
      `- Goal: g`,
      `- Workflow: coding`,
      `- Effort: high`,
      `- Revise kind: plan_revise`,
      ``,
      `**Rules**`,
      `- Compare the current artifacts against the goal and the workflow's success criteria.`,
      `- Cite evidence (file paths, output, observed behavior) \u2014 never speculate.`,
      `- If the artifacts are acceptable, set \`pass\` true and leave \`required_changes\` empty.`,
      `- If something is missing rather than wrong, prefer \`missing_context\` over \`required_changes\`.`,
      `- Pick exactly one \`action\`: \`proceed\`, \`retry\`, \`revise\`, \`ask_user\`, or \`handoff\`.`,
      ``,
      `**Output (JSON-like, all fields required)**`,
      `- \`pass\`: boolean \u2014 do the artifacts meet the goal?`,
      `- \`issues\`: array of concrete problems.`,
      `- \`missing_context\`: array of information needed but absent.`,
      `- \`required_changes\`: array of specific edits to make if \`pass\` is false.`,
      `- \`confidence\`: number in [0, 1].`,
      `- \`action\`: one of \`proceed | retry | revise | ask_user | handoff\`.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Reviewer checkpoint variant matches the approved snapshot", () => {
  test("renders to the exact checkpointNode prompt", () => {
    const template = pick("reviewer", "checkpoint")
    const rendered = renderTemplate(template.content, {
      goal: "G",
      workflow: "review",
      effort: "high",
    })
    const expected = [
      `You are the reviewer at a budget checkpoint. Summarize mission progress without continuing exploration \u2014 your job is to read state, not to advance it.`,
      ``,
      `**Mission inputs**`,
      `- Goal: G`,
      `- Workflow: review`,
      `- Effort: high`,
      ``,
      `**Rules**`,
      `- Classify each todo or sub-goal into exactly one of: \`completed\`, \`partial\`, \`not_started\`, \`blocked\`.`,
      `- Cite evidence for \`completed\` and \`partial\` items \u2014 file paths, command output, test results.`,
      `- For \`blocked\` items, name the blocker concretely.`,
      `- Do not start new work. Do not make edits. This is a status report.`,
      `- Suggest continuation only when there is concrete additional value to capture; otherwise leave \`suggested_continuation\` empty.`,
      ``,
      `**Output (JSON-like, all fields required)**`,
      `- \`completed\`: array of items finished with evidence.`,
      `- \`partial\`: array of items with progress but not complete.`,
      `- \`not_started\`: array of items still untouched.`,
      `- \`blocked\`: array of items with named blockers.`,
      `- \`evidence_summary\`: condensed summary of the strongest evidence gathered.`,
      `- \`unresolved_claims\`: assertions the mission has made that remain unverified.`,
      `- \`quality_summary\`: one-paragraph judgment of the work quality so far.`,
      `- \`suggested_continuation\`: the next step worth taking, or empty if the mission should stop.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Planner default variant matches the approved snapshot", () => {
  test("renders to the exact plannerNode prompt", () => {
    const template = pick("planner", "default")
    const rendered = renderTemplate(template.content, {
      goal: "g",
      workflow: "coding",
      effort: "deep",
    })
    const expected = [
      `You are the planner for this mission. Produce or refine the execution plan that drives downstream agents.`,
      ``,
      `**Mission inputs**`,
      `- Goal: g`,
      `- Workflow: coding`,
      `- Effort: deep`,
      ``,
      `**Rules**`,
      `- Ground every claim in the evidence already gathered. Do not invent facts.`,
      `- If a critical premise is missing, surface it as missing_context \u2014 do not guess.`,
      `- Confidence is your honest probability that the plan succeeds as written, not a vibe.`,
      ``,
      `**Output (JSON-like, all fields required)**`,
      `- \`summary\`: one-paragraph statement of what the plan does and why.`,
      `- \`assumptions\`: explicit assumptions the plan relies on.`,
      `- \`missing_context\`: information the plan needs but does not have.`,
      `- \`risks\`: concrete failure modes ordered by likelihood \u00d7 impact.`,
      `- \`confidence\`: number in [0, 1].`,
      `- \`next_step\`: the single concrete action to take next.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Verifier shard variant matches the approved snapshot", () => {
  test("renders to the exact verifierShard prompt", () => {
    const template = pick("verifier", "shard")
    const rendered = renderTemplate(template.content, {
      goal: "g",
      checks_block: ["- typecheck passes", "- focused tests pass"].join("\n"),
    })
    const expected = [
      `You are the verifier for one quality dimension of this mission. Verify exactly the focus below \u2014 no broader review.`,
      ``,
      `**Mission inputs**`,
      `- Goal: g`,
      `- Verification focus:`,
      `- typecheck passes`,
      `- focused tests pass`,
      ``,
      `**Rules**`,
      `- Stay within the verification focus. Do not assess other dimensions, even if you spot issues.`,
      `- Run the smallest set of commands or reads needed to produce verdicts. Cite each one.`,
      `- If a check is impossible to verify with the available tools, say so under \`residual_risk\` rather than guessing.`,
      `- Confidence reflects how strongly the evidence supports your verdict, not how thorough the checks were.`,
      ``,
      `**Output (JSON-like, all fields required)**`,
      `- \`evidence\`: array of concrete observations (file path + line, command + output excerpt, test name + result).`,
      `- \`command_outputs\`: array of \`{ command, summary }\` for any commands you ran; empty if none.`,
      `- \`confidence\`: number in [0, 1].`,
      `- \`residual_risk\`: array of risks that remain even if the checks passed.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Reducer default variant matches the approved snapshot", () => {
  test("renders to the exact researchReducer prompt when projectDeepDive is false", () => {
    const template = pick("reducer", "default")
    const rendered = renderTemplate(template.content, { goal: "g" })
    const expected = [
      `You are the reducer. Merge the parallel researchers' outputs into one compact handoff for downstream agents.`,
      ``,
      `**Mission input**`,
      `- Goal: g`,
      ``,
      `**Rules**`,
      `- Deduplicate overlapping findings.`,
      `- Where researchers disagree, mark the conflict explicitly \u2014 do not silently pick one side.`,
      `- Do not invent facts that none of the researchers reported. If something is unknown, list it under \`open_questions\`.`,
      `- The handoff should be self-contained: a downstream agent must be able to act on it without re-reading the raw researcher outputs.`,
      ``,
      `**Output (JSON-like, all fields required)**`,
      `- \`summary\`: one paragraph capturing what was learned.`,
      `- \`key_files\`: array of \`path:line\` references that future agents will need.`,
      `- \`architecture_map\`: short description of the relevant subsystems and how they connect.`,
      `- \`risks\`: concrete failure modes or fragile areas.`,
      `- \`recommended_plan_changes\`: array of plan adjustments the findings suggest.`,
      `- \`open_questions\`: things the researchers could not answer.`,
      `- \`confidence\`: number in [0, 1].`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Reducer project-deep-dive variant matches the approved snapshot", () => {
  test("renders to researchReducer prompt with the projectDeepDive line included", () => {
    const template = pick("reducer", "project-deep-dive")
    const rendered = renderTemplate(template.content, { goal: "g" })
    const expected = [
      `You are the reducer for a project-deep-dive mission. Merge the parallel researchers' outputs into one compact technical handoff.`,
      ``,
      `**Mission input**`,
      `- Goal: g`,
      ``,
      `**Rules**`,
      `- Deduplicate overlapping findings.`,
      `- Where researchers disagree, mark the conflict explicitly \u2014 do not silently pick one side.`,
      `- Do not invent facts that none of the researchers reported. If something is unknown, list it under \`open_questions\`.`,
      `- The architecture map must cover: core subsystems, key algorithms, data flows, safety/runtime boundaries, important files, extension points, and known unknowns.`,
      ``,
      `**Output (JSON-like, all fields required)**`,
      `- \`summary\`: one paragraph capturing the system's purpose and shape.`,
      `- \`key_files\`: array of \`path:line\` references that future agents will need.`,
      `- \`architecture_map\`: structured outline of subsystems, data flows, and boundaries.`,
      `- \`risks\`: concrete failure modes, fragile areas, or compliance hazards.`,
      `- \`recommended_plan_changes\`: array of plan adjustments the findings suggest.`,
      `- \`open_questions\`: things the researchers could not answer.`,
      `- \`confidence\`: number in [0, 1].`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Variant weights and frontmatter", () => {
  test("default variants have weight 1; alternate variants start at weight 0 (cold)", () => {
    expect(pick("reviser", "default").weight).toBe(1)
    expect(pick("reviser", "no-target").weight).toBe(0)
    expect(pick("planner", "default").weight).toBe(1)
    expect(pick("reducer", "default").weight).toBe(1)
    expect(pick("reducer", "project-deep-dive").weight).toBe(0)
  })
})
