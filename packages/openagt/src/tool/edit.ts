// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import z from "zod"
import * as path from "path"
import { Effect } from "effect"
import * as Tool from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./edit.txt"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { Format } from "../format"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectoryEffect } from "./external-directory"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { replace, trimDiff } from "./edit-replace"
export * from "./edit-replace"

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

          let diff = ""
          let contentOld = ""
          let contentNew = ""
          yield* Effect.gen(function* () {
            if (params.oldString === "") {
              const existed = yield* afs.existsSafe(filePath)
              if (existed) {
                throw new Error(
                  "oldString cannot be empty when editing an existing file. Provide the exact text to replace.",
                )
              }
              contentNew = params.newString
              diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))
              yield* ctx.ask({
                permission: "edit",
                patterns: [path.relative(Instance.worktree, filePath)],
                always: ["*"],
                metadata: {
                  filepath: filePath,
                  diff,
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
              },
            })

            yield* afs.writeWithDirs(filePath, contentNew)
            yield* format.file(filePath)
            yield* bus.publish(File.Event.Edited, { file: filePath })
            yield* bus.publish(FileWatcher.Event.Updated, {
              file: filePath,
              event: "change",
            })
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
            },
          })

          let output = "Edit applied successfully."
          yield* lsp.touchFile(filePath, true)
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilePath = AppFileSystem.normalizePath(filePath)
          const block = LSP.Diagnostic.report(filePath, diagnostics[normalizedFilePath] ?? [])
          if (block) output += `\n\nLSP errors detected in this file, please fix:\n${block}`

          return {
            metadata: {
              diagnostics,
              diff,
              filediff,
            },
            title: `${path.relative(Instance.worktree, filePath)}`,
            output,
          }
        }),
    }
  }),
)
