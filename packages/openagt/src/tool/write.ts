import z from "zod"
import * as path from "path"
import { Cause, Effect } from "effect"
import * as Tool from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { Event as BehaviorEvent } from "../bus/behavior-events"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { Instance } from "../project/instance"
import { Log } from "@/util"
import { trimDiff } from "./edit"
import { assertExternalDirectoryEffect } from "./external-directory"
import {
  buildDiagnosticFeedback,
  buildDiagnosticRepairPlan,
  diagnosticRepairPlanFromMetadata,
} from "../lsp/feedback"
import type { MessageV2 } from "../session/message-v2"

const log = Log.create({ service: "tool.write" })
const MAX_PROJECT_DIAGNOSTICS_FILES = 5

function lineRangeForContent(content: string) {
  return {
    start_line: 1,
    end_line: Math.max(1, content.split(/\r\n|\r|\n/).length),
  }
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

export const WriteTool = Tool.define(
  "write",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const format = yield* Format.Service

    return {
      description: DESCRIPTION,
      parameters: z.object({
        content: z.string().describe("The content to write to the file"),
        filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
      }),
      execute: (params: { content: string; filePath: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          yield* assertExternalDirectoryEffect(ctx, filepath)

          const exists = yield* fs.existsSafe(filepath)
          const contentOld = exists ? yield* fs.readFileString(filepath) : ""
          const diagnosticsBefore = yield* lsp.diagnostics()

          const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(Instance.worktree, filepath)],
            always: ["*"],
            metadata: {
              filepath,
              diff,
            },
          })

          yield* fs.writeWithDirs(filepath, params.content)
          yield* format.file(filepath)
          yield* bus.publish(File.Event.Edited, { file: filepath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: filepath,
            event: exists ? "change" : "add",
          })
          // Wave 6: behavior.file.touched lets a single audit consumer
          // reconstruct filesystem footprint without joining File.Event.Edited
          // and FileWatcher.Event.Updated against tool-call lifecycle events.
          yield* bus
            .publish(BehaviorEvent.FileTouched, {
              path: filepath,
              kind: "write",
              session_id: String(ctx.sessionID),
              tool_call_id: ctx.callID,
              bytes: params.content.length,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() =>
                  log.warn("behavior event publish failed", {
                    event: "file.touched",
                    kind: "write",
                    path: filepath,
                    cause: Cause.pretty(cause),
                  }),
                ),
              ),
            )

          let output = "Wrote file successfully."
          yield* lsp.touchFile(filepath, true)
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilepath = AppFileSystem.normalizePath(filepath)
          const lspFeedback = buildDiagnosticFeedback({
            file: filepath,
            normalizedFile: normalizedFilepath,
            before: diagnosticsBefore,
            after: diagnostics,
          })
          const relativeToWorktree = path.relative(Instance.worktree, filepath)
          const lspRepair = buildDiagnosticRepairPlan({
            feedback: lspFeedback,
            diagnostics: diagnostics[normalizedFilepath] ?? [],
            changedRange: lineRangeForContent(params.content),
            attempt: lspRepairAttempts(ctx.messages, filepath),
            fileInWorkspace: !relativeToWorktree.startsWith("..") && !path.isAbsolute(relativeToWorktree),
          })
          let projectDiagnosticsCount = 0
          for (const [file, issues] of Object.entries(diagnostics)) {
            const current = file === normalizedFilepath
            if (!current && projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
            const block = LSP.Diagnostic.report(current ? filepath : file, issues)
            if (!block) continue
            if (current) {
              output += `\n\nLSP errors detected in this file, please fix:\n${block}`
              continue
            }
            projectDiagnosticsCount++
            output += `\n\nLSP errors detected in other files:\n${block}`
          }

          return {
            title: path.relative(Instance.worktree, filepath),
            metadata: {
              diagnostics,
              lsp_feedback: lspFeedback,
              lsp_repair: lspRepair,
              filepath,
              exists: exists,
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
