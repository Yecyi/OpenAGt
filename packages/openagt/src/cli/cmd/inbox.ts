// Wave 10 — `openagt inbox` CLI subcommands.
//
// Closes the affordance loop on the user side: agents write inbox items
// via tool/escalate-to-inbox.ts; this CLI is how the user inspects and
// resolves them. Mirrors the SessionCommand pattern in session.ts —
// direct AppRuntime + Service.use access, no HTTP indirection, no
// running server required.

import type { Argv } from "yargs"
import { EOL } from "os"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { Locale } from "../../util"
import { PersonalAgent } from "../../personal/personal"
import { InboxItemID, InboxState, InboxSource } from "../../personal/schema"
import { Instance } from "../../project/instance"
import type { InboxItem } from "../../personal/schema"
import { AppRuntime } from "@/effect/app-runtime"

const STATE_VALUES = InboxState.options
const SOURCE_VALUES = InboxSource.options

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + "…"
}

function formatTable(items: readonly InboxItem[]): string {
  const idWidth = Math.max(8, ...items.map((item) => item.id.length))
  const stateWidth = Math.max(7, ...items.map((item) => item.state.length))
  const sourceWidth = Math.max(7, ...items.map((item) => item.source.length))
  const priorityWidth = Math.max(8, ...items.map((item) => item.priority.length))
  const goalWidth = 60
  const lines: string[] = []
  const header = `${"ID".padEnd(idWidth)}  ${"State".padEnd(stateWidth)}  ${"Source".padEnd(sourceWidth)}  ${"Priority".padEnd(priorityWidth)}  ${"Goal".padEnd(goalWidth)}  Created`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const item of items) {
    const goal = truncate(item.goal.replace(/\s+/g, " "), goalWidth)
    const created = Locale.todayTimeOrDateTime(item.time.created)
    lines.push(
      `${item.id.padEnd(idWidth)}  ${item.state.padEnd(stateWidth)}  ${item.source.padEnd(sourceWidth)}  ${item.priority.padEnd(priorityWidth)}  ${goal.padEnd(goalWidth)}  ${created}`,
    )
  }
  return lines.join(EOL)
}

function formatJSON(items: readonly InboxItem[]): string {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      projectID: item.projectID,
      sessionID: item.sessionID,
      source: item.source,
      scope: item.scope,
      goal: item.goal,
      context_refs: item.context_refs,
      priority: item.priority,
      state: item.state,
      scheduled_for: item.scheduled_for,
      payload: item.payload,
      time: item.time,
    })),
    null,
    2,
  )
}

function formatText(item: InboxItem): string {
  const lines: string[] = []
  lines.push(`ID:        ${item.id}`)
  lines.push(`State:     ${item.state}`)
  lines.push(`Source:    ${item.source}`)
  lines.push(`Scope:     ${item.scope}`)
  lines.push(`Priority:  ${item.priority}`)
  if (item.sessionID) lines.push(`Session:   ${item.sessionID}`)
  lines.push(`Created:   ${Locale.todayTimeOrDateTime(item.time.created)}`)
  lines.push(`Updated:   ${Locale.todayTimeOrDateTime(item.time.updated)}`)
  if (item.time.completed !== undefined) {
    lines.push(`Completed: ${Locale.todayTimeOrDateTime(item.time.completed)}`)
  }
  if (item.scheduled_for !== undefined) {
    lines.push(`Scheduled: ${Locale.todayTimeOrDateTime(item.scheduled_for)}`)
  }
  if (item.context_refs.length > 0) {
    lines.push(``)
    lines.push(`Context refs:`)
    for (const ref of item.context_refs) lines.push(`  - ${ref}`)
  }
  lines.push(``)
  lines.push(`Goal:`)
  lines.push(item.goal)
  if (item.payload && Object.keys(item.payload).length > 0) {
    lines.push(``)
    lines.push(`Payload:`)
    lines.push(JSON.stringify(item.payload, null, 2))
  }
  return lines.join(EOL)
}

export const InboxListCommand = cmd({
  command: "list",
  describe: "list inbox items for the current project",
  builder: (yargs: Argv) =>
    yargs
      .option("state", {
        describe: "filter by state",
        type: "string",
        choices: STATE_VALUES,
      })
      .option("source", {
        describe: "filter by source",
        type: "string",
        choices: SOURCE_VALUES,
      })
      .option("all", {
        describe: "include resolved (state=done) items; off by default",
        type: "boolean",
        default: false,
      })
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent items",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const projectID = Instance.project.id
      const all = await AppRuntime.runPromise(PersonalAgent.Service.use((svc) => svc.listInboxItems({ projectID })))
      let items = all
      if (args.state) items = items.filter((item) => item.state === args.state)
      if (args.source) items = items.filter((item) => item.source === args.source)
      if (!args.all && !args.state) items = items.filter((item) => item.state !== "done")
      if (args.maxCount) items = items.slice(0, args.maxCount)
      if (items.length === 0) {
        UI.println("(no inbox items)")
        return
      }
      const output = args.format === "json" ? formatJSON(items) : formatTable(items)
      console.log(output)
    })
  },
})

export const InboxViewCommand = cmd({
  command: "view <inboxID>",
  describe: "show full content of an inbox item",
  builder: (yargs: Argv) =>
    yargs
      .positional("inboxID", {
        describe: "inbox item ID to view",
        type: "string",
        demandOption: true,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["text", "json"],
        default: "text",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const projectID = Instance.project.id
      const all = await AppRuntime.runPromise(PersonalAgent.Service.use((svc) => svc.listInboxItems({ projectID })))
      const item = all.find((entry) => entry.id === args.inboxID)
      if (!item) {
        UI.error(`Inbox item not found: ${args.inboxID}`)
        process.exit(1)
      }
      const output = args.format === "json" ? formatJSON([item]) : formatText(item)
      console.log(output)
    })
  },
})

export const InboxResolveCommand = cmd({
  command: "resolve <inboxID>",
  describe: "mark an inbox item resolved, optionally with a reply",
  builder: (yargs: Argv) =>
    yargs
      .positional("inboxID", {
        describe: "inbox item ID to resolve",
        type: "string",
        demandOption: true,
      })
      .option("reply", {
        describe: "reply text passed back to the agent's payload (verbatim, no paraphrase)",
        type: "string",
      })
      .option("state", {
        describe: "terminal state when no reply is supplied; default 'done'",
        type: "string",
        choices: ["done", "cancelled"] as const,
        default: "done",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const id = InboxItemID.zod.parse(args.inboxID)
      if (typeof args.reply === "string") {
        const updated = await AppRuntime.runPromise(
          PersonalAgent.Service.use((svc) => svc.replyToInboxItem({ id, reply: args.reply as string })),
        )
        UI.println(
          UI.Style.TEXT_SUCCESS_BOLD +
            `Inbox item ${updated.id} resolved with reply (${updated.state}).` +
            UI.Style.TEXT_NORMAL,
        )
        return
      }
      const updated = await AppRuntime.runPromise(
        PersonalAgent.Service.use((svc) => svc.updateInboxState({ id, state: args.state as "done" | "cancelled" })),
      )
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD + `Inbox item ${updated.id} state set to ${updated.state}.` + UI.Style.TEXT_NORMAL,
      )
    })
  },
})

export const InboxDispatchCommand = cmd({
  command: "dispatch",
  describe: "manually dispatch any due-but-not-yet-fired scheduled wakeups for this project",
  builder: (yargs: Argv) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const projectID = Instance.project.id
      const dispatched = await AppRuntime.runPromise(
        PersonalAgent.Service.use((svc) => svc.dispatchDueWakeups({ projectID })),
      )
      if (dispatched.length === 0) {
        UI.println("(no due wakeups)")
        return
      }
      const output = args.format === "json" ? formatJSON(dispatched) : formatTable(dispatched)
      console.log(output)
    })
  },
})

export const InboxCommand = cmd({
  command: "inbox",
  describe: "manage agent-written inbox items (escalate_to_inbox / task_give_up affordance loop)",
  builder: (yargs: Argv) =>
    yargs
      .command(InboxListCommand)
      .command(InboxViewCommand)
      .command(InboxResolveCommand)
      .command(InboxDispatchCommand)
      .demandCommand(),
  async handler() {},
})
