import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import {
  probeWindowsHelper,
  resolveWindowsHelperPath,
  runWindowsHelperSetup,
  WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
  type WindowsSandboxSetupResult,
} from "../../sandbox/windows-helper"
import { Flag } from "../../flag/flag"

const WindowsProbeCommand = cmd({
  command: "probe",
  describe: "inspect the Windows native sandbox helper",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "Print machine-readable JSON",
    }),
  handler: (args: { json: boolean }) => {
    const resolved = resolveWindowsHelperPath({ override: Flag.OPENAGT_SANDBOX_WINDOWS_HELPER })
    const status = resolved.path
      ? probeWindowsHelper(resolved.path)
      : {
          name: "windows_native" as const,
          available: false,
          reason: resolved.reason ?? "Windows native helper unavailable",
          setup_required: false,
        }
    const output = {
      helper_protocol_required: WINDOWS_SANDBOX_HELPER_PROTOCOL_VERSION,
      helper_path: resolved.path ?? null,
      helper_override_used: resolved.source === "override",
      backend_run_loop_enabled: status.available,
      status,
    }
    if (args.json) {
      console.log(JSON.stringify(output, null, 2))
      return
    }
    UI.println("Windows sandbox helper")
    UI.println(`  required protocol: ${output.helper_protocol_required}`)
    UI.println(`  helper path: ${output.helper_path ?? "(not found)"}`)
    UI.println(`  override used: ${output.helper_override_used ? "yes" : "no"}`)
    UI.println(`  helper available: ${status.available ? "yes" : "no"}`)
    if (status.reason) UI.println(`  reason: ${status.reason}`)
    if (status.helper_protocol_version !== undefined) {
      UI.println(`  helper protocol: ${status.helper_protocol_version}`)
    }
    if (status.setup_required) UI.println(`  setup required: ${status.setup_reason ?? "yes"}`)
    if (status.setup_version) UI.println(`  setup version: ${status.setup_version}`)
    if (status.filesystem_ready !== undefined) {
      UI.println(`  filesystem ready: ${status.filesystem_ready ? "yes" : "no"}`)
    }
    if (status.filesystem_enforced !== undefined) {
      UI.println(`  filesystem enforcement: ${status.filesystem_enforced ? "yes" : "no"}`)
    }
    if (status.network_ready !== undefined) {
      UI.println(`  network ready: ${status.network_ready ? "yes" : "no"}`)
    }
    if (status.network_enforced !== undefined) {
      UI.println(`  network enforcement: ${status.network_enforced ? "yes" : "no"}`)
    }
    if (status.network_policies_enforced?.length) {
      UI.println(`  network policies: ${status.network_policies_enforced.join(", ")}`)
    }
    UI.println(`  backend run loop: ${output.backend_run_loop_enabled ? "enabled" : "not enabled"}`)
  },
})

const WindowsSetupCommand = cmd({
  command: "setup",
  describe: "install, uninstall, or inspect Windows sandbox setup",
  builder: (yargs: Argv) =>
    yargs
      .option("install", {
        type: "boolean",
        describe: "Install elevated Windows sandbox setup state",
      })
      .option("uninstall", {
        type: "boolean",
        describe: "Remove Windows sandbox setup state",
      })
      .option("status", {
        type: "boolean",
        describe: "Inspect Windows sandbox setup state",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Print machine-readable JSON",
      })
      .check((args) => {
        const selected = [args.install, args.uninstall, args.status].filter(Boolean).length
        if (selected !== 1) throw new Error("Choose exactly one of --install, --uninstall, or --status")
        return true
      }),
  handler: (args: { install?: boolean; uninstall?: boolean; status?: boolean; json: boolean }) => {
    const resolved = resolveWindowsHelperPath({ override: Flag.OPENAGT_SANDBOX_WINDOWS_HELPER })
    const mode = args.install ? "install" : args.uninstall ? "uninstall" : "status"
    const result: WindowsSandboxSetupResult = resolved.path
      ? runWindowsHelperSetup(resolved.path, mode)
      : {
          ok: false,
          mode,
          setup_installed: false,
          setup_required: true,
          setup_reason: resolved.reason ?? "Windows native helper unavailable",
        }
    if (args.json) {
      console.log(JSON.stringify({ helper_path: resolved.path ?? null, ...result }, null, 2))
      return
    }
    UI.println(`Windows sandbox setup: ${mode}`)
    UI.println(`  helper path: ${resolved.path ?? "(not found)"}`)
    UI.println(`  ok: ${result.ok ? "yes" : "no"}`)
    UI.println(`  installed: ${result.setup_installed ? "yes" : "no"}`)
    UI.println(`  setup required: ${result.setup_required ? "yes" : "no"}`)
    if (result.elevated !== undefined) {
      UI.println(`  elevated: ${result.elevated ? "yes" : "no"}`)
    }
    if (result.restricted_token_supported !== undefined) {
      UI.println(`  restricted token: ${result.restricted_token_supported ? "yes" : "no"}`)
    }
    if (result.job_object_supported !== undefined) {
      UI.println(`  job object: ${result.job_object_supported ? "yes" : "no"}`)
    }
    if (result.filesystem_ready !== undefined) {
      UI.println(`  filesystem ready: ${result.filesystem_ready ? "yes" : "no"}`)
    }
    if (result.filesystem_enforced !== undefined) {
      UI.println(`  filesystem enforcement: ${result.filesystem_enforced ? "yes" : "no"}`)
    }
    if (result.filesystem_reason) UI.println(`  filesystem reason: ${result.filesystem_reason}`)
    if (result.network_ready !== undefined) {
      UI.println(`  network ready: ${result.network_ready ? "yes" : "no"}`)
    }
    if (result.network_enforced !== undefined) {
      UI.println(`  network enforcement: ${result.network_enforced ? "yes" : "no"}`)
    }
    if (result.network_policies_enforced?.length) {
      UI.println(`  network policies: ${result.network_policies_enforced.join(", ")}`)
    }
    if (result.network_reason) UI.println(`  network reason: ${result.network_reason}`)
    if (result.setup_reason) UI.println(`  reason: ${result.setup_reason}`)
  },
})

const WindowsCommand = cmd({
  command: "windows",
  describe: "Windows native sandbox helper tools",
  builder: (yargs: Argv) => yargs.command(WindowsProbeCommand).command(WindowsSetupCommand).demandCommand(),
  handler: () => {},
})

export const SandboxCommand = cmd({
  command: "sandbox",
  describe: "sandbox diagnostics and setup tools",
  builder: (yargs: Argv) => yargs.command(WindowsCommand).demandCommand(),
  handler: () => {},
})
