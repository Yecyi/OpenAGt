// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import z from "zod"
import * as path from "path"
import { Cause, Effect } from "effect"
import * as Tool from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./edit.txt"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { Event as BehaviorEvent } from "../bus/behavior-events"
import { Format } from "../format"
import { Instance } from "../project/instance"
import { Log } from "@/util"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectoryEffect } from "./external-directory"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { replace, trimDiff } from "./edit-replace"
import { buildDiagnosticFeedback, buildDiagnosticRepairPlan, diagnosticRepairPlanFromMetadata } from "../lsp/feedback"
import { detectEolStyle, type EolStyle } from "@/util/text"
import type { MessageV2 } from "../session/message-v2"
export * from "./edit-replace"

const log = Log.create({ service: "tool.edit" })

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}

function roundTripMetadata(style: EolStyle) {
  return {
    eol_style: style,
    unicode_safe_truncation: true,
    round_trip_partial: style === "mixed",
    round_trip_reason: style === "mixed" ? "mixed_eol" : undefined,
  }
}

function changedLineRange(before: string, after: string) {
  let line = 1
  let start: number | undefined
  let end: number | undefined
  for (const change of diffLines(before, after)) {
    const count = change.count ?? change.value.split(/\r\n|\r|\n/).length - 1
    if (change.added || change.removed) {
      start = start ?? line
      end = Math.max(end ?? line, line + Math.max(0, change.added ? count - 1 : 0))
    }
    if (!change.removed) line += count
  }
  if (start === undefined || end === undefined) return
  return { start_line: start, end_line: Math.max(start, end) }
}

function lspRepairAttempts(messages: MessageV2.WithParts[], filePath: string) {
  const normalized = AppFileSystem.normalizePath(filePath)
  return messages
    .flatMap((message) => message.parts)
    .flatMap((part) => {
      if (part.type !== "tool" || part.state.status !== "completed") return []
      return [diagnosticRepairPlanFromMetadata(part.state.metadata?.lsp_repair)]
    })
    .filter((plan) => plan?.files.some((file) => AppFileSystem.normalizePath(file) === normalized))
    .length
}

const Parameters = z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  oldString: z.string().describe("The text to replace"),
  newString: z.string().describe("The text to replace it with (must be different from oldString)"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
})

export const EditTool = Tool.define(
  "edit",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* AppFileSystem.Service
    const format = yield* Format.Service
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.filePath) {
            throw new Error("filePath is required")
          }

          if (params.oldString === params.newString) {
            throw new Error("No changes to apply: oldString and newString are identical.")
          }

          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          yield* assertExternalDirectoryEffect(ctx, filePath)
          const diagnosticsBefore = yield* lsp.diagnostics()

          let diff = ""
          let contentOld = ""
          let contentNew = ""
          let eolStyle: EolStyle = "none"
          yield* Effect.gen(function* () {
            if (params.oldString === "") {
              const existed = yield* afs.existsSafe(filePath)
              if (existed) {
                throw new Error(
                  "oldString cannot be empty when editing an existing file. Provide the exact text to replace.",
                )
              }
              contentNew = params.newString
              eolStyle = detectEolStyle(contentNew)
              diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
              yield* ctx.ask({
                permission: "edit",
                patterns: [path.relative(Instance.worktree, filePath)],
                always: ["*"],
                metadata: {
                  filepath: filePath,
                  diff,
                  ...roundTripMetadata(eolStyle),
                },
              })
              yield* afs.writeWithDirs(filePath, params.newString)
              yield* format.file(filePath)
              yield* bus.publish(File.Event.Edited, { file: filePath })
              yield* bus.publish(FileWatcher.Event.Updated, {
                file: filePath,
                event: existed ? "change" : "add",
              })
              return
            }

            const info = yield* afs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!info) throw new Error(`File ${filePath} not found`)
            if (info.type === "Directory") throw new Error(`Path is a directory, not a file: ${filePath}`)
            contentOld = yield* afs.readFileString(filePath)

            eolStyle = detectEolStyle(contentOld)
            const ending = detectLineEnding(contentOld)
            const old = convertToLineEnding(normalizeLineEndings(params.oldString), ending)
            const next = convertToLineEnding(normalizeLineEndings(params.newString), ending)

            contentNew = replace(contentOld, old, next, params.replaceAll)

            diff = trimDiff(
              createTwoFilesPatch(
                filePath,
                filePath,
                normalizeLineEndings(contentOld),
                normalizeLineEndings(contentNew),
              ),
            )
            yield* ctx.ask({
              permission: "edit",
              patterns: [path.relative(Instance.worktree, filePath)],
              always: ["*"],
              metadata: {
                filepath: filePath,
                diff,
                ...roundTripMetadata(eolStyle),
              },
            })

            yield* afs.writeWithDirs(filePath, contentNew)
            yield* format.file(filePath)
            yield* bus.publish(File.Event.Edited, { file: filePath })
            yield* bus.publish(FileWatcher.Event.Updated, {
              file: filePath,
              event: "change",
            })
            // Wave 6: behavior.file.touched. See bus/behavior-events.ts.
            yield* bus
              .publish(BehaviorEvent.FileTouched, {
                path: filePath,
                kind: "edit",
                session_id: String(ctx.sessionID),
                tool_call_id: ctx.callID,
                bytes: contentNew.length,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.sync(() =>
                    log.warn("behavior event publish failed", {
                      event: "file.touched",
                      kind: "edit",
                      path: filePath,
                      cause: Cause.pretty(cause),
                    }),
                  ),
                ),
              )
            contentNew = yield* afs.readFileString(filePath)
            diff = trimDiff(
              createTwoFilesPatch(
                filePath,
                filePath,
                normalizeLineEndings(contentOld),
                normalizeLineEndings(contentNew),
              ),
            )
          }).pipe(Effect.orDie)

          const filediff: Snapshot.FileDiff = {
            file: filePath,
            patch: diff,
            additions: 0,
            deletions: 0,
          }
          for (const change of diffLines(contentOld, contentNew)) {
            if (change.added) filediff.additions += change.count || 0
            if (change.removed) filediff.deletions += change.count || 0
          }

          yield* ctx.metadata({
            metadata: {
              diff,
              filediff,
              diagnostics: {},
              ...roundTripMetadata(eolStyle),
            },
          })

          let output = "Edit applied successfully."
          yield* lsp.touchFile(filePath, true)
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilePath = AppFileSystem.normalizePath(filePath)
          const lspFeedback = buildDiagnosticFeedback({
            file: filePath,
            normalizedFile: normalizedFilePath,
            before: diagnosticsBefore,
            after: diagnostics,
          })
          const relativeToWorktree = path.relative(Instance.worktree, filePath)
          const lspRepair = buildDiagnosticRepairPlan({
            feedback: lspFeedback,
            diagnostics: diagnostics[normalizedFilePath] ?? [],
            changedRange: changedLineRange(contentOld, contentNew),
            attempt: lspRepairAttempts(ctx.messages, filePath),
            fileInWorkspace: !relativeToWorktree.startsWith("..") && !path.isAbsolute(relativeToWorktree),
          })
          if (lspFeedback.report) output += `\n\nLSP errors detected in this file, please fix:\n${lspFeedback.report}`
          yield* ctx.metadata({
            metadata: {
              diff,
              filediff,
              diagnostics,
              lsp_feedback: lspFeedback,
              lsp_repair: lspRepair,
              ...roundTripMetadata(eolStyle),
            },
          })

          return {
            metadata: {
              diagnostics,
              lsp_feedback: lspFeedback,
              lsp_repair: lspRepair,
              diff,
              filediff,
              ...roundTripMetadata(eolStyle),
            },
            title: `${path.relative(Instance.worktree, filePath)}`,
            output,
          }
        }),
    }
  }),
)
