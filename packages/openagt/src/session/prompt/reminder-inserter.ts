// Injects plan/build reminder parts into the latest user message.
// It does not choose models, run tools, or change prompt loop scheduling.

import path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { Flag } from "../../flag/flag"
import { MessageV2 } from "../message-v2"
import { PartID } from "../schema"
import * as Session from "../session"
import BUILD_SWITCH from "./build-switch.txt"
import PROMPT_PLAN from "./plan.txt"
import { addReminder } from "./reminder"

export type PromptReminderInserterInput = {
  messages: MessageV2.WithParts[]
  agent: { name: string }
  session: Session.Info
}

export class PromptReminderInserter {
  constructor(
    private readonly deps: {
      fsys: AppFileSystem.Interface
      sessions: Session.Interface
    },
  ) {}

  run(input: PromptReminderInserterInput): Effect.Effect<MessageV2.WithParts[]> {
    const deps = this.deps
    return Effect.gen(function* () {
      const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
      if (!userMessage) return input.messages

      if (!Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE) {
        if (input.agent.name === "plan") {
          // A-P1-3: Add to reminder budget with high importance
          addReminder(PROMPT_PLAN, 8)
          userMessage.parts.push({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: PROMPT_PLAN,
            synthetic: true,
          })
        }
        const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
        if (wasPlan && input.agent.name === "build") {
          // A-P1-3: Add to reminder budget with high importance
          addReminder(BUILD_SWITCH, 8)
          userMessage.parts.push({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: BUILD_SWITCH,
            synthetic: true,
          })
        }
        return input.messages
      }

      const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
      if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
        const plan = Session.plan(input.session)
        if (!(yield* deps.fsys.existsSafe(plan))) return input.messages
        const text = `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`
        // A-P1-3: Add to reminder budget with high importance
        addReminder(text, 8)
        const part = yield* deps.sessions.updatePart({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text,
          synthetic: true,
        })
        userMessage.parts.push(part)
        return input.messages
      }

      if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

      const plan = Session.plan(input.session)
      const exists = yield* deps.fsys.existsSafe(plan)
      if (!exists) yield* deps.fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
      const part = yield* deps.sessions.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${exists ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.` : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 4 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
 - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
 - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
 - For broad project/codebase deep dives, architecture outlines, technical details, or algorithm analysis, use 3-4 explore agents by default rather than one broad explorer.
 - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: structure/entrypoints, agent runtime/tools/coordinator, data/memory/safety/events, tests/release/docs.
 - When you need to inspect files directly, use Glob/Grep/Read. Do not use Bash for directory listings or file reading during repository exploration.

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return input.messages
    })
  }
}
