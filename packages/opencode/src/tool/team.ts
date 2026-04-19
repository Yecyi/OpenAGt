/**
 * Team Communication Tools
 *
 * Provides tools for multi-agent team coordination, inspired by Claude Code's
 * TeamCreate, TeamDelete, and SendMessage tools.
 */

import { Effect, Context } from "effect"
import { Tool } from "./tool"
import { Log } from "@/util"
import { z } from "zod"

const log = Log.create({ service: "tool.team" })

// Tool names
export const TEAM_CREATE_TOOL_NAME = "TeamCreate"
export const TEAM_DELETE_TOOL_NAME = "TeamDelete"
export const SEND_MESSAGE_TOOL_NAME = "SendMessage"

// Team and message types
export interface Team {
  id: string
  name: string
  members: string[]
  createdAt: number
  leaderId: string
}

export interface TeamMessage {
  id: string
  from: string
  to: string
  text: string
  timestamp: number
  read: boolean
  teamName: string
}

// Team state
const teams = new Map<string, Team>()
const messages = new Map<string, TeamMessage[]>()

/**
 * Generate unique IDs
 */
function generateTeamId(): string {
  return `team-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// ============================================================================
// TeamCreate Tool
// ============================================================================

const teamCreateInputSchema = z.object({
  name: z.string().describe("Team name"),
  members: z.array(z.string()).optional().describe("Initial team members"),
})

const teamCreateOutputSchema = z.object({
  team: z.object({
    id: z.string(),
    name: z.string(),
    leaderId: z.string(),
  }),
})

export type TeamCreateInput = z.infer<typeof teamCreateInputSchema>
export type TeamCreateOutput = z.infer<typeof teamCreateOutputSchema>

export const teamCreateTool: Tool = {
  name: TEAM_CREATE_TOOL_NAME,
  description: "Create a new team for multi-agent coordination",
  inputSchema: teamCreateInputSchema,
  outputSchema: teamCreateOutputSchema,

  execute: (input: TeamCreateInput, context: Tool.Context) => {
    return Effect.gen(function* () {
      const id = generateTeamId()
      const leaderId = context.agentId ?? "coordinator"

      const team: Team = {
        id,
        name: input.name,
        members: input.members ?? [leaderId],
        createdAt: Date.now(),
        leaderId,
      }

      teams.set(id, team)
      messages.set(id, [])

      log.debug("team created", { id, name: input.name })

      return {
        team: {
          id,
          name: input.name,
          leaderId,
        },
      }
    })
  },
}

// ============================================================================
// TeamDelete Tool
// ============================================================================

const teamDeleteInputSchema = z.object({
  teamId: z.string().describe("Team ID to delete"),
  reason: z.string().optional().describe("Reason for deletion"),
})

const teamDeleteOutputSchema = z.object({
  deleted: z.boolean(),
  teamId: z.string(),
})

export type TeamDeleteInput = z.infer<typeof teamDeleteInputSchema>
export type TeamDeleteOutput = z.infer<typeof teamDeleteOutputSchema>

export const teamDeleteTool: Tool = {
  name: TEAM_DELETE_TOOL_NAME,
  description: "Delete a team and all its messages",
  inputSchema: teamDeleteInputSchema,
  outputSchema: teamDeleteOutputSchema,

  execute: (input: TeamDeleteInput, context: Tool.Context) => {
    return Effect.gen(function* () {
      const team = teams.get(input.teamId)

      if (!team) {
        return {
          error: `Team not found: ${input.teamId}`,
        }
      }

      // Clean up messages
      messages.delete(input.teamId)
      teams.delete(input.teamId)

      log.info("team deleted", { id: input.teamId, reason: input.reason })

      return {
        deleted: true,
        teamId: input.teamId,
      }
    })
  },
}

// ============================================================================
// SendMessage Tool
// ============================================================================

const sendMessageInputSchema = z.object({
  to: z.string().describe("Recipient agent ID or name"),
  message: z.string().describe("Message content"),
  teamName: z.string().optional().describe("Team name for routing"),
})

const sendMessageOutputSchema = z.object({
  messageId: z.string(),
  sentAt: z.number(),
  recipient: z.string(),
})

export type SendMessageInput = z.infer<typeof sendMessageInputSchema>
export type SendMessageOutput = z.infer<typeof sendMessageOutputSchema>

export const sendMessageTool: Tool = {
  name: SEND_MESSAGE_TOOL_NAME,
  description: "Send a message to a team member or other agent",
  inputSchema: sendMessageInputSchema,
  outputSchema: sendMessageOutputSchema,

  execute: (input: SendMessageInput, context: Tool.Context) => {
    return Effect.gen(function* () {
      const messageId = generateMessageId()
      const from = context.agentName ?? "unknown"
      const teamName = input.teamName ?? "default"

      const message: TeamMessage = {
        id: messageId,
        from,
        to: input.to,
        text: input.message,
        timestamp: Date.now(),
        read: false,
        teamName,
      }

      // Find or create team for this conversation
      let team = Array.from(teams.values()).find(
        (t) => t.name === teamName || t.members.includes(input.to)
      )

      if (!team) {
        // Create a default team if none exists
        const teamId = generateTeamId()
        team = {
          id: teamId,
          name: teamName,
          members: [from, input.to],
          createdAt: Date.now(),
          leaderId: from,
        }
        teams.set(teamId, team)
        messages.set(teamId, [])
      }

      // Add message to team's message history
      const teamMessages = messages.get(team.id) ?? []
      teamMessages.push(message)
      messages.set(team.id, teamMessages)

      log.debug("message sent", {
        id: messageId,
        from,
        to: input.to,
      })

      return {
        messageId,
        sentAt: message.timestamp,
        recipient: input.to,
      }
    })
  },
}

// ============================================================================
// Read mailbox for agent
// ============================================================================

export function readMailbox(
  agentName: string,
  teamName?: string
): TeamMessage[] {
  const allMessages: TeamMessage[] = []

  for (const [teamId, teamMessages] of messages.entries()) {
    const team = teams.get(teamId)
    if (!team) continue
    if (teamName && team.name !== teamName) continue
    if (!team.members.includes(agentName)) continue

    for (const msg of teamMessages) {
      if (msg.to === agentName && !msg.read) {
        allMessages.push(msg)
      }
    }
  }

  return allMessages.sort((a, b) => a.timestamp - b.timestamp)
}

export function markMessageAsRead(messageId: string): void {
  for (const teamMessages of messages.values()) {
    const msg = teamMessages.find((m) => m.id === messageId)
    if (msg) {
      msg.read = true
      break
    }
  }
}

// ============================================================================
// Export all tools
// ============================================================================

export const teamTools = [teamCreateTool, teamDeleteTool, sendMessageTool]
