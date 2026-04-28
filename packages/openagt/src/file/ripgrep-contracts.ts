// Ripgrep service contracts and JSON output schemas.
// This file defines input/result shapes only; it does not spawn ripgrep or touch the filesystem.

import { Effect, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import z from "zod"

const Stats = z.object({
  elapsed: z.object({
    secs: z.number(),
    nanos: z.number(),
    human: z.string(),
  }),
  searches: z.number(),
  searches_with_match: z.number(),
  bytes_searched: z.number(),
  bytes_printed: z.number(),
  matched_lines: z.number(),
  matches: z.number(),
})

export const Begin = z.object({
  type: z.literal("begin"),
  data: z.object({
    path: z.object({
      text: z.string(),
    }),
  }),
})

export const Match = z.object({
  type: z.literal("match"),
  data: z.object({
    path: z.object({
      text: z.string(),
    }),
    lines: z.object({
      text: z.string(),
    }),
    line_number: z.number(),
    absolute_offset: z.number(),
    submatches: z.array(
      z.object({
        match: z.object({
          text: z.string(),
        }),
        start: z.number(),
        end: z.number(),
      }),
    ),
  }),
})

export const End = z.object({
  type: z.literal("end"),
  data: z.object({
    path: z.object({
      text: z.string(),
    }),
    binary_offset: z.number().nullable(),
    stats: Stats,
  }),
})

export const Summary = z.object({
  type: z.literal("summary"),
  data: z.object({
    elapsed_total: z.object({
      human: z.string(),
      nanos: z.number(),
      secs: z.number(),
    }),
    stats: Stats,
  }),
})

export const Result = z.union([Begin, Match, End, Summary])

export type Result = z.infer<typeof Result>
export type Match = z.infer<typeof Match>
export type Item = Match["data"]
export type Begin = z.infer<typeof Begin>
export type End = z.infer<typeof End>
export type Summary = z.infer<typeof Summary>
export type Row = Match["data"]

export interface SearchResult {
  items: Item[]
  partial: boolean
}

export interface FilesInput {
  cwd: string
  glob?: string[]
  hidden?: boolean
  follow?: boolean
  maxDepth?: number
  signal?: AbortSignal
}

export interface SearchInput {
  cwd: string
  pattern: string
  glob?: string[]
  limit?: number
  follow?: boolean
  file?: string[]
  signal?: AbortSignal
}

export interface TreeInput {
  cwd: string
  limit?: number
  signal?: AbortSignal
}

export interface Interface {
  readonly files: (input: FilesInput) => Stream.Stream<string, PlatformError | Error>
  readonly tree: (input: TreeInput) => Effect.Effect<string, PlatformError | Error>
  readonly search: (input: SearchInput) => Effect.Effect<SearchResult, PlatformError | Error>
}
