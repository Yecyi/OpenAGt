import path from "path"
import { Context, Effect, Layer } from "effect"
import { Config } from "@/config"
import { Instance } from "@/project/instance"
import * as Truncate from "@/tool/truncate"
import type { ShellDecision, ShellRiskLevel, ShellSecurityResult } from "@/security/shell-security"
import type {
  SandboxBackendPreference,
  SandboxConfig,
  SandboxEnforcement,
  SandboxFilesystemPolicy,
  SandboxNetworkPolicy,
} from "./types"

export type ResolveInput = {
  result: ShellSecurityResult
  decision?: ShellDecision
  cwd: string
  externalPaths: string[]
}

export type ResolvedPolicy = {
  sandbox: SandboxConfig
  enforcement: SandboxEnforcement
  backend_preference: SandboxBackendPreference
  filesystem_policy: SandboxFilesystemPolicy
  network_policy: SandboxNetworkPolicy
  allowed_paths: string[]
  writable_paths: string[]
  needs_network_permission: boolean
}

function normalizePaths(input: string[]) {
  return Array.from(
    new Set(
      input
        .map((item) => path.resolve(item))
        .filter(Boolean)
        .sort((a, b) => a.length - b.length)
        .filter((item, index, list) => !list.some((other, i) => i < index && item.startsWith(other + path.sep))),
    ),
  )
}

function inferNetwork(result: ShellSecurityResult) {
  const text = result.normalized_command.toLowerCase()
  const findings = result.findings.some((item) => item.category === "network_exfiltration")
  const command = /\b(curl|wget|invoke-webrequest|invoke-restmethod|nc|ncat|scp|ssh)\b/.test(text)
  return findings || command
}

function enforcement(decision: ShellDecision, risk: ShellRiskLevel): SandboxEnforcement {
  if (decision === "confirm" || risk === "medium" || risk === "high") return "required"
  return "advisory"
}

function writablePaths(cwd: string, externalPaths: string[]) {
  return normalizePaths([cwd, Instance.directory, Instance.worktree, Truncate.DIR, ...externalPaths])
}

function allowedPaths(cwd: string, externalPaths: string[]) {
  return normalizePaths([cwd, Instance.directory, Instance.worktree, Truncate.DIR, ...externalPaths])
}

export interface Interface {
  readonly config: () => Effect.Effect<SandboxConfig>
  readonly resolve: (input: ResolveInput) => Effect.Effect<ResolvedPolicy>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SandboxPolicy") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const sandboxConfig = Effect.fn("SandboxPolicy.config")(function* () {
      const cfg = yield* config.get()
      const sandbox = cfg.experimental?.sandbox
      return {
        enabled: sandbox?.enabled ?? true,
        backend: sandbox?.backend ?? "auto",
        failure_policy: sandbox?.failure_policy ?? "closed",
        report_only: sandbox?.report_only ?? false,
        broker_idle_ttl_ms: sandbox?.broker_idle_ttl_ms ?? 300_000,
      } satisfies SandboxConfig
    })

    const resolve: Interface["resolve"] = Effect.fn("SandboxPolicy.resolve")(function* (input) {
      const sandbox = yield* sandboxConfig()
      const needsNetwork = inferNetwork(input.result)
      const allowed = allowedPaths(input.cwd, input.externalPaths)
      const writable = writablePaths(input.cwd, input.externalPaths)
      const decision = input.decision ?? input.result.decision
      return {
        sandbox,
        enforcement: enforcement(decision, input.result.risk_level),
        backend_preference: sandbox.backend,
        filesystem_policy: "workspace_write",
        network_policy: needsNetwork ? "full" : "none",
        allowed_paths: allowed,
        writable_paths: writable,
        needs_network_permission: needsNetwork,
      } satisfies ResolvedPolicy
    })

    return Service.of({
      config: sandboxConfig,
      resolve,
    })
  }),
)

export const defaultLayer = layer
export const liveLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as SandboxPolicy from "./policy"
