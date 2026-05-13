import os from "os"
import path from "path"
import { Effect } from "effect"
import * as Truncate from "@/tool/truncate"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import type { MessageV2 } from "./message-v2"

type SessionUpdatePart = <T extends MessageV2.Part>(part: T) => Effect.Effect<T>

export function isAbortLikeError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return message.includes("abort") || message.includes("cancel") || message.includes("interrupt")
}

export function isShellRunnerBash(
  part: MessageV2.ToolPart,
  metadata: Record<string, unknown>,
  output: string,
): boolean {
  const partInput = isRecord(part.state.input) ? part.state.input : {}
  return (
    part.tool === "bash" &&
    (typeof partInput.command === "string" ||
      typeof partInput.description === "string" ||
      typeof partInput.timeout === "number" ||
      typeof partInput.workdir === "string" ||
      output.length > 0 ||
      typeof metadata.description === "string" ||
      typeof metadata.backendPreference === "string" ||
      typeof metadata.enforcement === "string")
  )
}

export function completeInterruptedBashFor(session: { updatePart: SessionUpdatePart }) {
  return Effect.fn("SessionProcessor.completeInterruptedBash")(function* (
    part: MessageV2.ToolPart,
    metadata: Record<string, unknown>,
    output: string,
    end: number,
  ) {
    const captured = output || "(no output captured before abort)"
    const truncated =
      metadata.truncated === true ||
      output.length === 0 ||
      captured.startsWith("...\n\n") ||
      Buffer.byteLength(captured, "utf-8") > Truncate.MAX_BYTES
    const outputPath = truncated
      ? path.join(os.tmpdir(), `openagt-bash-output-${Date.now()}-${part.id}.txt`)
      : undefined
    if (outputPath) yield* Effect.promise(() => Bun.write(outputPath, captured))
    yield* session.updatePart({
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        output:
          (truncated && outputPath
            ? `...output truncated...\n\nFull output saved to: ${outputPath}\n\n${captured}`
            : captured) + "\n\n<bash_metadata>\nUser aborted the command\n</bash_metadata>",
        metadata: {
          ...metadata,
          output: captured,
          truncated,
          ...(outputPath ? { outputPath } : {}),
          terminationReason: "abort",
          interrupted: true,
          interruption_origin: "session_cleanup",
          root_cause: "bash_result_missing_after_session_interrupt",
        },
        title: typeof metadata.description === "string" ? metadata.description : "Shell command",
        time: { start: "time" in part.state ? part.state.time.start : end, end },
      },
    })
  })
}
