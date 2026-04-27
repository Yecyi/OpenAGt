// `openagt experts` — surfaces the v1.21 ExpertRegistry. Lists builtin and
// user-registered roles so operators can see what's loaded without having to
// inspect the source.

import type { Argv } from "yargs"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "../../project/instance"
import { ExpertRegistry } from "../../coordinator/expert-registry"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { errorMessage } from "../../util/error"
import { EOL } from "os"

const ExpertsListCommand = cmd({
  command: "list",
  describe: "list registered expert roles (builtin + user)",
  builder: (yargs: Argv) =>
    yargs
      .option("source", {
        type: "string",
        choices: ["all", "builtin", "user"],
        default: "all",
        describe: "Filter by registration source",
      })
      .option("domain", {
        type: "string",
        describe: "Only show experts tagged with this domain",
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"],
        default: "text",
        describe: "Output format",
      }),
  async handler(args: { source: string; domain?: string; format: string }) {
    try {
      await Instance.provide({
        directory: process.cwd(),
        async fn() {
          const entries = await AppRuntime.runPromise(ExpertRegistry.Service.use((svc) => svc.all()))
          const filtered = entries
            .filter((e) => args.source === "all" || e.source === args.source)
            .filter((e) => !args.domain || e.domain === args.domain)
            .sort((a, b) => {
              if (a.source !== b.source) return a.source === "builtin" ? -1 : 1
              return a.role.localeCompare(b.role)
            })
          if (args.format === "json") {
            console.log(JSON.stringify(filtered, null, 2))
            return
          }
          UI.println(`Registered experts: ${filtered.length} (filter: source=${args.source}${args.domain ? `, domain=${args.domain}` : ""})`)
          UI.println("")
          for (const e of filtered) {
            const tags: string[] = [e.source]
            if (e.domain) tags.push(`domain=${e.domain}`)
            if (e.inherits) tags.push(`inherits=${e.inherits}`)
            if (e.mpacr_perspective) tags.push(`mpacr=${e.mpacr_perspective}`)
            process.stdout.write(`${e.role}  [${tags.join(", ")}]` + EOL)
            if (e.description && e.source === "user") {
              process.stdout.write(`    ${e.description}` + EOL)
            }
          }
        },
      })
    } catch (err) {
      UI.error(errorMessage(err))
      process.exit(1)
    }
  },
})

const ExpertsShowCommand = cmd({
  command: "show <role>",
  describe: "show full definition of a single expert role",
  builder: (yargs: Argv) =>
    yargs
      .positional("role", {
        type: "string",
        describe: "Expert role name (e.g. 'factuality-checker' or 'tax-law-checker')",
        demandOption: true,
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"],
        default: "text",
        describe: "Output format",
      }),
  async handler(args: { role: string; format: string }) {
    try {
      await Instance.provide({
        directory: process.cwd(),
        async fn() {
          const entry = await AppRuntime.runPromise(ExpertRegistry.Service.use((svc) => svc.get(args.role)))
          if (!entry) {
            UI.error(`Expert role not found: ${args.role}`)
            process.exit(1)
          }
          if (args.format === "json") {
            console.log(JSON.stringify(entry, null, 2))
            return
          }
          UI.println(`role:               ${entry.role}`)
          UI.println(`source:             ${entry.source}`)
          if (entry.inherits) UI.println(`inherits:           ${entry.inherits}`)
          if (entry.domain) UI.println(`domain:             ${entry.domain}`)
          UI.println(`description:        ${entry.description}`)
          if (entry.workflows) UI.println(`workflows:          ${entry.workflows.join(", ")}`)
          if (entry.output_schema) UI.println(`output_schema:      ${entry.output_schema}`)
          if (entry.prompt_template_id) UI.println(`prompt_template_id: ${entry.prompt_template_id}`)
          if (entry.mpacr_perspective) UI.println(`mpacr_perspective:  ${entry.mpacr_perspective}`)
          if (entry.memory_namespace) UI.println(`memory_namespace:   ${entry.memory_namespace}`)
          if (entry.acceptance_checks?.length) {
            UI.println(`acceptance_checks:`)
            for (const c of entry.acceptance_checks) UI.println(`  - ${c}`)
          }
          if (entry.prompt) {
            UI.println(`prompt:`)
            for (const line of entry.prompt.split("\n")) UI.println(`  | ${line}`)
          }
        },
      })
    } catch (err) {
      UI.error(errorMessage(err))
      process.exit(1)
    }
  },
})

export const ExpertsCommand = cmd({
  command: "experts",
  describe: "manage and inspect coordinator expert roles",
  builder: (yargs: Argv) => yargs.command(ExpertsListCommand).command(ExpertsShowCommand).demandCommand(),
  handler: () => {},
})
