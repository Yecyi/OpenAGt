import * as Predicate from "effect/Predicate"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import type * as NodeChildProcess from "node:child_process"

export const env = (opts: ChildProcess.CommandOptions) =>
  opts.extendEnv ? { ...globalThis.process.env, ...opts.env } : opts.env

const input = (x: ChildProcess.CommandInput | undefined): NodeChildProcess.IOType | undefined =>
  Stream.isStream(x) ? "pipe" : x

const output = (x: ChildProcess.CommandOutput | undefined): NodeChildProcess.IOType | undefined =>
  Sink.isSink(x) ? "pipe" : x

export const stdin = (opts: ChildProcess.CommandOptions): ChildProcess.StdinConfig => {
  const cfg: ChildProcess.StdinConfig = { stream: "pipe", encoding: "utf-8", endOnDone: true }
  if (Predicate.isUndefined(opts.stdin)) return cfg
  if (typeof opts.stdin === "string") return { ...cfg, stream: opts.stdin }
  if (Stream.isStream(opts.stdin)) return { ...cfg, stream: opts.stdin }
  return {
    stream: opts.stdin.stream,
    encoding: opts.stdin.encoding ?? cfg.encoding,
    endOnDone: opts.stdin.endOnDone ?? cfg.endOnDone,
  }
}

export const stdio = (opts: ChildProcess.CommandOptions, key: "stdout" | "stderr"): ChildProcess.StdoutConfig => {
  const cfg = opts[key]
  if (Predicate.isUndefined(cfg)) return { stream: "pipe" }
  if (typeof cfg === "string") return { stream: cfg }
  if (Sink.isSink(cfg)) return { stream: cfg }
  return { stream: cfg.stream }
}

export const fds = (opts: ChildProcess.CommandOptions) => {
  if (Predicate.isUndefined(opts.additionalFds)) return []
  return Object.entries(opts.additionalFds)
    .flatMap(([name, config]) => {
      const fd = ChildProcess.parseFdName(name)
      return Predicate.isUndefined(fd) ? [] : [{ fd, config }]
    })
    .toSorted((a, b) => a.fd - b.fd)
}

export const stdios = (
  sin: ChildProcess.StdinConfig,
  sout: ChildProcess.StdoutConfig,
  serr: ChildProcess.StderrConfig,
  extra: ReadonlyArray<{ fd: number; config: ChildProcess.AdditionalFdConfig }>,
): NodeChildProcess.StdioOptions => {
  const pipe = (x: NodeChildProcess.IOType | undefined) =>
    process.platform === "win32" && x === "pipe" ? "overlapped" : x
  const arr: Array<NodeChildProcess.IOType | undefined> = [
    pipe(input(sin.stream)),
    pipe(output(sout.stream)),
    pipe(output(serr.stream)),
  ]
  if (extra.length === 0) return arr as NodeChildProcess.StdioOptions
  const max = extra.reduce((acc, x) => Math.max(acc, x.fd), 2)
  for (let i = 3; i <= max; i++) arr[i] = "ignore"
  for (const x of extra) arr[x.fd] = pipe("pipe")
  return arr as NodeChildProcess.StdioOptions
}
