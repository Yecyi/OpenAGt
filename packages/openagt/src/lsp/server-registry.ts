// Builds the enabled LSP server registry from config and feature flags.
// It does not spawn clients, resolve file roots, or send LSP requests.
import { Flag } from "@/flag/flag"
import type { ConfigLSP } from "@/config/lsp"
import { Log } from "@/util"
import { spawn as lspspawn } from "./launch"
import * as LSPServer from "./server"

const log = Log.create({ service: "lsp" })

function filterExperimentalServers(servers: Record<string, LSPServer.Info>): void {
  if (Flag.OPENCODE_EXPERIMENTAL_LSP_TY) {
    if (servers["pyright"]) {
      log.info("LSP server pyright is disabled because OPENCODE_EXPERIMENTAL_LSP_TY is enabled")
      delete servers["pyright"]
    }
    return
  }

  if (servers["ty"]) {
    delete servers["ty"]
  }
}

export function buildServerRegistry(input: ConfigLSP.Info | undefined): Record<string, LSPServer.Info> {
  const servers: Record<string, LSPServer.Info> = {}

  if (!input) {
    log.info("all LSPs are disabled")
    return servers
  }

  for (const server of Object.values(LSPServer)) {
    servers[server.id] = server
  }

  filterExperimentalServers(servers)

  if (input !== true) {
    for (const [name, item] of Object.entries(input)) {
      const existing = servers[name]
      if (item.disabled) {
        log.info(`LSP server ${name} is disabled`)
        delete servers[name]
        continue
      }
      if (!("command" in item)) continue
      servers[name] = {
        ...existing,
        id: name,
        root: existing?.root ?? (async (_file, ctx) => ctx.directory),
        extensions: item.extensions ?? existing?.extensions ?? [],
        spawn: async (root) => ({
          process: lspspawn(item.command[0], item.command.slice(1), {
            cwd: root,
            env: { ...process.env, ...item.env },
          }),
          initialization: item.initialization,
        }),
      }
    }
  }

  log.info("enabled LSP servers", {
    serverIds: Object.values(servers)
      .map((server) => server.id)
      .join(", "),
  })

  return servers
}
