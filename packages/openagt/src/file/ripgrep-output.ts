// Ripgrep output parsing and path normalization.
// This file parses rg JSON rows only; it does not run ripgrep or manage aborts.

import path from "path"
import { Effect } from "effect"
import { Result, type Row } from "./ripgrep-contracts"

export function clean(file: string): string {
  return path.normalize(file.replace(/^\.[\\/]/, ""))
}

export function row(data: Row): Row {
  return {
    ...data,
    path: {
      ...data.path,
      text: clean(data.path.text),
    },
  }
}

export function parse(line: string) {
  return Effect.try({
    try: () => Result.parse(JSON.parse(line)),
    catch: (cause) => new Error("invalid ripgrep output", { cause }),
  })
}
