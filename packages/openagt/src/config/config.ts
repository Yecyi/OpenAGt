import { Log } from "../util"
import path from "path"
import os from "os"
import z from "zod"
import { mergeDeep } from "remeda"
import { Global } from "../global"
import fsNode from "fs/promises"
import { NamedError } from "@openagt/shared/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance, type InstanceContext } from "../project/instance"
import { InstallationLocal, InstallationVersion } from "@/installation/version"
import { existsSync } from "fs"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { Account } from "@/account/account"
import type { ConsoleState } from "./console-state"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { InstanceState } from "@/effect"
import { Context, Duration, Effect, Exit, Fiber, Layer, Option } from "effect"
import { EffectFlock } from "@openagt/shared/util/effect-flock"
import { ConfigAgent } from "./agent"
import { ConfigExpert } from "./expert"
import { ConfigCommand } from "./command"
import { ConfigExecPolicy } from "./exec-policy"
import { ConfigFormatter } from "./formatter"
import { ConfigLayout } from "./layout"
import { ConfigLSP } from "./lsp"
import { ConfigManaged } from "./managed"
import { ConfigMCP } from "./mcp"
import { ConfigModelID } from "./model-id"
import { ConfigPaths } from "./paths"
import { ConfigPlugin } from "./plugin"
import { ConfigProvider } from "./provider"
import { ConfigServer } from "./server"
import { ConfigSkills } from "./skills"
import { CONFIG_SCHEMA_URL, ConfigFileLoader } from "./file-loader"
import { ConfigGlobalLoader } from "./global-loader"
import { ConfigInstanceMergePipeline } from "./instance-merge-pipeline"
import { ConfigWriter } from "./writer"
import { EffectiveConfigSnapshot, type EffectiveConfigSnapshot as EffectiveConfigSnapshotType } from "./effective-config"
import { Npm } from "@/npm"
import { withProcessEnv } from "@/util/process-env"
import type { SandboxBackendPreference, SandboxFailurePolicy } from "@/sandbox/types"
import type { Info } from "./info"
export { Info } from "./info"
export {
  AdvancedGlobalConfigPatch,
  ConfigSource,
  ConfigSourceScope,
  EffectiveConfigField,
  EffectiveConfigSnapshot,
} from "./effective-config"

const log = Log.create({ service: "config" })

export const Server = ConfigServer.Server.zod
export const Layout = ConfigLayout.Layout.zod
export type Layout = ConfigLayout.Layout

type State = {
  config: Info
  effective: EffectiveConfigSnapshotType
  directories: string[]
  deps: Fiber.Fiber<void, never>[]
  consoleState: ConsoleState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly effective: () => Effect.Effect<EffectiveConfigSnapshotType>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly update: (config: Info) => Effect.Effect<void>
  readonly updateGlobal: (config: Info) => Effect.Effect<Info>
  readonly invalidate: (wait?: boolean) => Effect.Effect<void>
  readonly invalidateDirectory: (dir: string) => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

export const ConfigDirectoryTypoError = NamedError.create(
  "ConfigDirectoryTypoError",
  z.object({
    path: z.string(),
    dir: z.string(),
    suggestion: z.string(),
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const authSvc = yield* Auth.Service
    const accountSvc = yield* Account.Service
    const env = yield* Env.Service
    const npmSvc = yield* Npm.Service
    const fileLoader = new ConfigFileLoader(fs, log)
    const globalLoader = new ConfigGlobalLoader(fileLoader)
    const writer = new ConfigWriter(fs, fileLoader)
    const loadConfig = (text: string, options: { path: string } | { dir: string; source: string }) =>
      fileLoader.loadConfig(text, options)
    const loadFile = (filepath: string) => fileLoader.loadFile(filepath)

    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
      globalLoader.loadGlobal().pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error("failed to load global config, using defaults", { error: String(error) })),
        ),
        Effect.orElseSucceed((): Info => ({})),
      ),
      Duration.infinity,
    )

    const getGlobal = Effect.fn("Config.getGlobal")(function* () {
      return yield* cachedGlobal
    })

    const ensureGitignore = Effect.fn("Config.ensureGitignore")(function* (dir: string) {
      const gitignore = path.join(dir, ".gitignore")
      yield* Effect.promise(() => fsNode.mkdir(dir, { recursive: true })).pipe(Effect.orDie)
      const hasIgnore = yield* fs.existsSafe(gitignore)
      if (!hasIgnore) {
        yield* fs
          .writeFileString(
            gitignore,
            ["node_modules", "package.json", "package-lock.json", "bun.lock", ".gitignore"].join("\n"),
          )
          .pipe(
            Effect.catchIf(
              (e) => e.reason._tag === "PermissionDenied",
              () => Effect.void,
            ),
          )
      }
    })

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(
      function* (ctx: InstanceContext) {
        const auth = yield* authSvc.all().pipe(Effect.orDie)

        const pipeline = new ConfigInstanceMergePipeline()
        const consoleManagedProviders = new Set<string>()
        let activeOrgName: string | undefined

        for (const [key, value] of Object.entries(auth)) {
          if (value.type === "wellknown") {
            const url = key.replace(/\/+$/, "")
            yield* withProcessEnv(
              { [value.key]: value.token },
              Effect.gen(function* () {
                log.debug("fetching remote config", { url: `${url}/.well-known/opencode` })
                const response = yield* Effect.promise(() => fetch(`${url}/.well-known/opencode`))
                if (!response.ok) {
                  throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
                }
                const wellknown = (yield* Effect.promise(() => response.json())) as { config?: Record<string, unknown> }
                const remoteConfig = wellknown.config ?? {}
                if (!remoteConfig.$schema) {
                  remoteConfig.$schema = CONFIG_SCHEMA_URL
                }
                const source = `${url}/.well-known/opencode`
                const next = yield* loadConfig(JSON.stringify(remoteConfig), {
                  dir: path.dirname(source),
                  source,
                })
                yield* pipeline.merge(source, next, "global")
                log.debug("loaded remote config from well-known", { url })
              }),
            )
          }
        }

        const global = yield* getGlobal()
        yield* pipeline.merge(Global.Path.config, global, "global")

        if (Flag.OPENCODE_CONFIG) {
          yield* pipeline.merge(Flag.OPENCODE_CONFIG, yield* loadFile(Flag.OPENCODE_CONFIG))
          log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
        }

        if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
          for (const file of yield* ConfigPaths.files("opencode", ctx.directory, ctx.worktree).pipe(Effect.orDie)) {
            yield* pipeline.merge(file, yield* loadFile(file), "local")
          }
        }

        pipeline.result.agent = pipeline.result.agent || {}
        pipeline.result.mode = pipeline.result.mode || {}
        pipeline.result.plugin = pipeline.result.plugin || []

        const directories = yield* ConfigPaths.directories(ctx.directory, ctx.worktree)

        if (Flag.OPENCODE_CONFIG_DIR) {
          log.debug("loading config from OPENCODE_CONFIG_DIR", { path: Flag.OPENCODE_CONFIG_DIR })
        }

        const deps: Fiber.Fiber<void, never>[] = []

        for (const dir of directories) {
          if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {
            for (const file of ["opencode.json", "opencode.jsonc"]) {
              const source = path.join(dir, file)
              log.debug(`loading config from ${source}`)
              yield* pipeline.merge(source, yield* loadFile(source))
              pipeline.result.agent ??= {}
              pipeline.result.mode ??= {}
              pipeline.result.plugin ??= []
            }
          }

          yield* ensureGitignore(dir).pipe(Effect.orDie)

          const dep = yield* npmSvc
            .install(dir, {
              add: [
                {
                  name: "@openagt/plugin",
                  version: InstallationLocal ? undefined : InstallationVersion,
                },
              ],
            })
            .pipe(
              Effect.exit,
              Effect.tap((exit) =>
                Exit.isFailure(exit)
                  ? Effect.sync(() => {
                      log.warn("background dependency install failed", { dir, error: String(exit.cause) })
                    })
                  : Effect.void,
              ),
              Effect.asVoid,
              Effect.forkDetach,
            )
          deps.push(dep)

          pipeline.result.command = mergeDeep(
            pipeline.result.command ?? {},
            yield* Effect.promise(() => ConfigCommand.load(dir)),
          )
          pipeline.result.agent = mergeDeep(
            pipeline.result.agent ?? {},
            yield* Effect.promise(() => ConfigAgent.load(dir)),
          )
          pipeline.result.agent = mergeDeep(
            pipeline.result.agent ?? {},
            yield* Effect.promise(() => ConfigAgent.loadMode(dir)),
          )
          // C.1 — load .opencode/experts/*.md the same way as agents/commands.
          pipeline.result.expert = mergeDeep(
            pipeline.result.expert ?? {},
            yield* Effect.promise(() => ConfigExpert.load(dir)),
          )
          // Auto-discovered plugins under `.opencode/plugin(s)` are already local files, so ConfigPlugin.load
          // returns normalized Specs and we only need to attach origin metadata here.
          const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
          yield* pipeline.mergePluginOrigins(dir, list)
        }

        if (process.env.OPENCODE_CONFIG_CONTENT) {
          const source = "OPENCODE_CONFIG_CONTENT"
          const next = yield* loadConfig(process.env.OPENCODE_CONFIG_CONTENT, {
            dir: ctx.directory,
            source,
          })
          yield* pipeline.merge(source, next, "local")
          log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
        }

        const activeAccount = Option.getOrUndefined(
          yield* accountSvc.active().pipe(Effect.catch(() => Effect.succeed(Option.none()))),
        )
        if (activeAccount?.active_org_id) {
          const accountID = activeAccount.id
          const orgID = activeAccount.active_org_id
          const url = activeAccount.url
          yield* Effect.gen(function* () {
            const [configOpt, tokenOpt] = yield* Effect.all(
              [accountSvc.config(accountID, orgID), accountSvc.token(accountID)],
              { concurrency: 2 },
            )
            const applyAccountConfig = Effect.gen(function* () {
              if (Option.isSome(tokenOpt)) yield* env.set("OPENCODE_CONSOLE_TOKEN", tokenOpt.value)

              if (Option.isSome(configOpt)) {
                const source = `${url}/api/config`
                const next = yield* loadConfig(JSON.stringify(configOpt.value), {
                  dir: path.dirname(source),
                  source,
                })
                for (const providerID of Object.keys(next.provider ?? {})) {
                  consoleManagedProviders.add(providerID)
                }
                yield* pipeline.merge(source, next, "global")
              }
            })

            if (Option.isSome(tokenOpt)) {
              yield* withProcessEnv({ OPENCODE_CONSOLE_TOKEN: tokenOpt.value }, applyAccountConfig)
              return
            }
            yield* applyAccountConfig
          }).pipe(
            Effect.withSpan("Config.loadActiveOrgConfig"),
            Effect.catch((err) => {
              log.debug("failed to fetch remote account config", {
                error: err instanceof Error ? err.message : String(err),
              })
              return Effect.void
            }),
          )
        }

        const managedDir = ConfigManaged.managedConfigDir()
        if (existsSync(managedDir)) {
          for (const file of ["opencode.json", "opencode.jsonc"]) {
            const source = path.join(managedDir, file)
            yield* pipeline.merge(source, yield* loadFile(source), "global", "managed")
          }
        }

        // macOS managed preferences (.mobileconfig deployed via MDM) override everything
        const managed = yield* Effect.promise(() => ConfigManaged.readManagedPreferences())
        if (managed) {
          pipeline.mergeConfigOnly(
            managed.source,
            yield* loadConfig(managed.text, {
              dir: path.dirname(managed.source),
              source: managed.source,
            }),
            "managed",
          )
        }

        for (const [name, mode] of Object.entries(pipeline.result.mode ?? {})) {
          pipeline.result.agent = mergeDeep(pipeline.result.agent ?? {}, {
            [name]: {
              ...mode,
              mode: "primary" as const,
            },
          })
        }

        if (Flag.OPENCODE_PERMISSION) {
          pipeline.result.permission = mergeDeep(pipeline.result.permission ?? {}, JSON.parse(Flag.OPENCODE_PERMISSION))
          pipeline.recordField("permission", "OPENCODE_PERMISSION", "flag")
        }

        pipeline.applyToolsPermissionCompatibility()

        if (!pipeline.result.username) pipeline.result.username = os.userInfo().username

        if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) {
          pipeline.result.compaction = { ...pipeline.result.compaction, auto: false }
          pipeline.recordField("compaction", "OPENCODE_DISABLE_AUTOCOMPACT", "flag")
        }
        if (Flag.OPENCODE_DISABLE_PRUNE) {
          pipeline.result.compaction = { ...pipeline.result.compaction, prune: false }
          pipeline.recordField("compaction", "OPENCODE_DISABLE_PRUNE", "flag")
        }

        return {
          config: pipeline.result,
          effective: pipeline.snapshot(),
          directories,
          deps,
          consoleState: {
            consoleManagedProviders: Array.from(consoleManagedProviders),
            activeOrgName,
            switchableOrgCount: 0,
          },
        }
      },
      Effect.provideService(AppFileSystem.Service, fs),
    )

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx).pipe(Effect.orDie)
      }),
    )

    const get = Effect.fn("Config.get")(function* () {
      return yield* InstanceState.use(state, (s) => s.config)
    })

    const effective = Effect.fn("Config.effective")(function* () {
      return yield* InstanceState.use(state, (s) => s.effective)
    })

    const directories = Effect.fn("Config.directories")(function* () {
      return yield* InstanceState.use(state, (s) => s.directories)
    })

    const getConsoleState = Effect.fn("Config.getConsoleState")(function* () {
      return yield* InstanceState.use(state, (s) => s.consoleState)
    })

    const waitForDependencies = Effect.fn("Config.waitForDependencies")(function* () {
      yield* InstanceState.useEffect(state, (s) =>
        Effect.forEach(s.deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.asVoid),
      )
    })

    const update = Effect.fn("Config.update")(function* (config: Info) {
      const dir = yield* InstanceState.directory
      const file = path.join(dir, "config.json")
      yield* writer.updateInstanceFile(file, config)
      yield* invalidate()
    })

    const invalidate = Effect.fn("Config.invalidate")(function* (wait?: boolean) {
      yield* invalidateGlobal
      const task = Instance.disposeAll()
        .catch(() => undefined)
        .finally(() =>
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Event.Disposed.type,
              properties: {},
            },
          }),
        )
      if (wait) yield* Effect.promise(() => task)
      else void task
    })

    const invalidateDirectory = Effect.fn("Config.invalidateDirectory")(function* (dir: string) {
      log.info("config directory invalidation requested", { directory: dir })
    })

    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info) {
      const next = yield* writer.updateGlobal(config)
      yield* invalidate()
      return next
    })

    return Service.of({
      get,
      effective,
      getGlobal,
      getConsoleState,
      update,
      updateGlobal,
      invalidate,
      invalidateDirectory,
      directories,
      waitForDependencies,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Account.defaultLayer),
  Layer.provide(Npm.defaultLayer),
)
