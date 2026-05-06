import path from "path"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { Context, Effect, Fiber, Layer, Queue, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { Global } from "@/global"
import { Log } from "@/util"
import { which } from "@/util/which"
import { filesArgs, searchArgs } from "./ripgrep-args"
import {
  Begin as BeginSchema,
  End as EndSchema,
  Match as MatchSchema,
  Result as ResultSchema,
  Summary as SummarySchema,
} from "./ripgrep-contracts"
import type {
  Interface as RipgrepInterface,
  Match as RipgrepMatch,
  SearchInput as RipgrepSearchInput,
  TreeInput as RipgrepTreeInput,
} from "./ripgrep-contracts"
import { clean, parse, row, skipped } from "./ripgrep-output"
import { env, error, fail, raceAbort } from "./ripgrep-runtime"

export const Begin = BeginSchema
export const End = EndSchema
export const Match = MatchSchema
export const Result = ResultSchema
export const Summary = SummarySchema
export type Begin = import("./ripgrep-contracts").Begin
export type End = import("./ripgrep-contracts").End
export type FilesInput = import("./ripgrep-contracts").FilesInput
export type Interface = import("./ripgrep-contracts").Interface
export type Item = import("./ripgrep-contracts").Item
export type Match = import("./ripgrep-contracts").Match
export type Result = import("./ripgrep-contracts").Result
export type Row = import("./ripgrep-contracts").Row
export type SearchInput = import("./ripgrep-contracts").SearchInput
export type SearchResult = import("./ripgrep-contracts").SearchResult
export type Summary = import("./ripgrep-contracts").Summary
export type TreeInput = import("./ripgrep-contracts").TreeInput

const log = Log.create({ service: "ripgrep" })
const VERSION = "14.1.1"
const PLATFORM = {
  "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
  "arm64-linux": { platform: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
  "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
  "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
  "arm64-win32": { platform: "aarch64-pc-windows-msvc", extension: "zip" },
  "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
} as const

export class Service extends Context.Service<Service, RipgrepInterface>()("@opencode/Ripgrep") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | ChildProcessSpawner | HttpClient.HttpClient> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const spawner = yield* ChildProcessSpawner

      const run = Effect.fnUntraced(function* (command: string, args: string[], opts?: { cwd?: string }) {
        const handle = yield* spawner.spawn(
          ChildProcess.make(command, args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
        )
        const [stdout, stderr, code] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(handle.stdout)),
            Stream.mkString(Stream.decodeText(handle.stderr)),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        )
        return { stdout, stderr, code }
      }, Effect.scoped)

      const usable = Effect.fnUntraced(function* (candidate: string) {
        const file = yield* fs.isFile(candidate).pipe(Effect.orDie)
        if (!file) return false
        const result = yield* run(candidate, ["--version"]).pipe(Effect.exit)
        if (result._tag === "Failure") return false
        return result.value.code === 0
      })

      const extract = Effect.fnUntraced(function* (archive: string, config: (typeof PLATFORM)[keyof typeof PLATFORM]) {
        const dir = path.join(Global.Path.bin, `ripgrep-${Math.random().toString(36).slice(2, 8)}`)
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)

        if (config.extension === "zip") {
          const shell = (yield* Effect.sync(() => which("powershell.exe") ?? which("pwsh.exe"))) ?? "powershell.exe"
          const quote = (value: string) => value.replaceAll("'", "''")
          const result = yield* run(shell, [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath '${quote(archive)}' -DestinationPath '${quote(dir)}' -Force`,
          ])
          if (result.code !== 0) {
            return yield* Effect.fail(error(result.stderr || result.stdout, result.code))
          }
        }

        if (config.extension === "tar.gz") {
          const result = yield* run("tar", ["-xzf", archive, "-C", dir])
          if (result.code !== 0) {
            return yield* Effect.fail(error(result.stderr || result.stdout, result.code))
          }
        }

        const expected = path.join(
          dir,
          `ripgrep-${VERSION}-${config.platform}`,
          process.platform === "win32" ? "rg.exe" : "rg",
        )
        if (yield* fs.existsSafe(expected).pipe(Effect.orDie)) return expected
        const fallback = yield* fs
          .glob(`**/${process.platform === "win32" ? "rg.exe" : "rg"}`, {
            cwd: dir,
            absolute: true,
            include: "file",
            dot: true,
          })
          .pipe(Effect.orDie)
        if (fallback[0]) return fallback[0]
        return expected
      })

      const filepath = yield* Effect.cached(
        Effect.gen(function* () {
          const system = yield* Effect.sync(() => which("rg"))
          if (system && (yield* usable(system))) return system

          const target = path.join(Global.Path.bin, `rg${process.platform === "win32" ? ".exe" : ""}`)
          if (yield* usable(target)) return target

          const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
          const config = PLATFORM[platformKey]
          if (!config) {
            return yield* Effect.fail(new Error(`unsupported platform for ripgrep: ${platformKey}`))
          }

          const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
          const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`
          const archive = path.join(Global.Path.bin, filename)

          log.info("downloading ripgrep", { url })
          yield* fs.ensureDir(Global.Path.bin).pipe(Effect.orDie)

          const bytes = yield* HttpClientRequest.get(url).pipe(
            http.execute,
            Effect.flatMap((response) => response.arrayBuffer),
            Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
          )
          if (bytes.byteLength === 0) {
            return yield* Effect.fail(new Error(`failed to download ripgrep from ${url}`))
          }

          yield* fs.writeWithDirs(archive, new Uint8Array(bytes)).pipe(Effect.orDie)
          const extracted = yield* extract(archive, config)
          const exists = yield* fs.exists(extracted).pipe(Effect.orDie)
          if (!exists) {
            return yield* Effect.fail(new Error(`ripgrep archive did not contain executable: ${extracted}`))
          }

          yield* fs.copyFile(extracted, target).pipe(Effect.orDie)
          if (process.platform !== "win32") {
            yield* fs.chmod(target, 0o755).pipe(Effect.orDie)
          }
          yield* fs.remove(archive, { force: true }).pipe(Effect.ignore)
          return target
        }),
      )

      const check = Effect.fnUntraced(function* (cwd: string) {
        if (yield* fs.isDir(cwd).pipe(Effect.orDie)) return
        return yield* Effect.fail(
          Object.assign(new Error(`No such file or directory: '${cwd}'`), {
            code: "ENOENT",
            errno: -2,
            path: cwd,
          }),
        )
      })

      const command = Effect.fnUntraced(function* (cwd: string, args: string[]) {
        const binary = yield* filepath
        return ChildProcess.make(binary, args, {
          cwd,
          env: env(),
          extendEnv: true,
          stdin: "ignore",
        })
      })

      const files: RipgrepInterface["files"] = (input) =>
        Stream.callback<string, PlatformError | Error>((queue) =>
          Effect.gen(function* () {
            yield* Effect.forkScoped(
              Effect.gen(function* () {
                yield* check(input.cwd)
                const handle = yield* spawner.spawn(yield* command(input.cwd, filesArgs(input)))
                const stderr = yield* Stream.mkString(Stream.decodeText(handle.stderr)).pipe(Effect.forkScoped)
                const stdout = yield* Stream.decodeText(handle.stdout).pipe(
                  Stream.splitLines,
                  Stream.filter((line) => line.length > 0),
                  Stream.runForEach((line) => Effect.sync(() => Queue.offerUnsafe(queue, clean(line)))),
                  Effect.forkScoped,
                )
                const code = yield* raceAbort(handle.exitCode, input.signal)
                yield* Fiber.join(stdout)
                if (code === 0 || code === 1) {
                  Queue.endUnsafe(queue)
                  return
                }
                fail(queue, error(yield* Fiber.join(stderr), code))
              }).pipe(
                Effect.catch((err) =>
                  Effect.sync(() => {
                    fail(queue, err)
                  }),
                ),
              ),
            )
          }),
        )

      const search: RipgrepInterface["search"] = Effect.fn("Ripgrep.search")(function* (input: RipgrepSearchInput) {
        yield* check(input.cwd)

        const program = Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(yield* command(input.cwd, searchArgs(input)))

            const [items, stderr, code] = yield* Effect.all(
              [
                Stream.decodeText(handle.stdout).pipe(
                  Stream.splitLines,
                  Stream.filter((line) => line.length > 0),
                  Stream.mapEffect(parse),
                  Stream.filter((item): item is RipgrepMatch => item.type === "match"),
                  Stream.map((item) => row(item.data)),
                  Stream.runCollect,
                  Effect.map((chunk) => [...chunk]),
                ),
                Stream.mkString(Stream.decodeText(handle.stderr)),
                handle.exitCode,
              ],
              { concurrency: "unbounded" },
            )

            if (code !== 0 && code !== 1 && code !== 2) {
              return yield* Effect.fail(error(stderr, code))
            }

            const skippedPaths = skipped(stderr)
            if (code === 2 && skippedPaths.count === 0) {
              return yield* Effect.fail(error(stderr, code))
            }

            return {
              items: code === 1 ? [] : items,
              partial: code === 2 || skippedPaths.count > 0,
              skipped_count: skippedPaths.count,
              skipped_reason_sample: skippedPaths.sample,
            }
          }),
        )

        return yield* raceAbort(program, input.signal)
      })

      const tree: RipgrepInterface["tree"] = Effect.fn("Ripgrep.tree")(function* (input: RipgrepTreeInput) {
        log.info("tree", input)
        const list = Array.from(yield* files({ cwd: input.cwd, signal: input.signal }).pipe(Stream.runCollect))

        interface Node {
          name: string
          children: Map<string, Node>
        }

        function child(node: Node, name: string) {
          const item = node.children.get(name)
          if (item) return item
          const next = { name, children: new Map() }
          node.children.set(name, next)
          return next
        }

        function count(node: Node): number {
          return Array.from(node.children.values()).reduce((sum, child) => sum + 1 + count(child), 0)
        }

        const root: Node = { name: "", children: new Map() }
        for (const file of list) {
          if (file.includes(".opencode")) continue
          const parts = file.split(path.sep)
          if (parts.length < 2) continue
          let node = root
          for (const part of parts.slice(0, -1)) {
            node = child(node, part)
          }
        }

        const total = count(root)
        const limit = input.limit ?? total
        const lines: string[] = []
        const queue: Array<{ node: Node; path: string }> = Array.from(root.children.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((node) => ({ node, path: node.name }))

        let used = 0
        for (let i = 0; i < queue.length && used < limit; i++) {
          const item = queue[i]
          lines.push(item.path)
          used++
          queue.push(
            ...Array.from(item.node.children.values())
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((node) => ({ node, path: `${item.path}/${node.name}` })),
          )
        }

        if (total > used) lines.push(`[${total - used} truncated]`)
        return lines.join("\n")
      })

      return Service.of({ files, tree, search })
    }),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

export * as Ripgrep from "./ripgrep"
