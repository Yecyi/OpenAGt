import { cmd } from "./cmd"
import { McpAddCommand } from "./mcp/add"
import { McpAuthCommand } from "./mcp/auth"
import { McpDebugCommand } from "./mcp/debug"
import { McpListCommand } from "./mcp/list"
import { McpLogoutCommand } from "./mcp/logout"

export const McpCommand = cmd({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpDebugCommand)
      .demandCommand(),
  async handler() {},
})
