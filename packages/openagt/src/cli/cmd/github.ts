import { cmd } from "./cmd"
import { GithubInstallCommand } from "./github/install"
import { GithubRunCommand } from "./github/run"

export * from "./github/helpers"

export const GithubCommand = cmd({
  command: "github",
  describe: "manage GitHub agent",
  builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
  async handler() {},
})
