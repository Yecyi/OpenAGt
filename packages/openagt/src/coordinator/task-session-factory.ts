// Task session factory for coordinator subagent sessions.
// This file resolves subagent titles; it does not create task records or dispatch execution.

import { Agent } from "@/agent/agent"
import { Session } from "@/session"
import type { SessionID } from "@/session/schema"
import { Effect } from "effect"
import type { CoordinatorNode as CoordinatorNodeType } from "./schema"

export class CoordinatorTaskSessionFactory {
  constructor(
    private readonly agents: Agent.Interface,
    private readonly sessions: Session.Interface,
  ) {}

  create(input: { sessionID: SessionID; node: CoordinatorNodeType }) {
    const agents = this.agents
    const sessions = this.sessions
    return Effect.gen(function* () {
      const fallback = input.node.task_kind === "research" ? "explore" : "general"
      const agent = (yield* agents.get(input.node.subagent_type)) ?? (yield* agents.get(fallback))
      if (!agent) throw new Error(`Coordinator could not resolve subagent ${input.node.subagent_type}`)
      return yield* sessions.create({
        parentID: input.sessionID,
        title: `${input.node.description} (@${agent.name} subagent)`,
      })
    })
  }
}
