// Stateful output buffer for shell command streaming and final truncation.
// This file does not execute commands, choose sandboxes, or publish tool permissions.

import { Effect } from "effect"

const MAX_METADATA_LENGTH = 30_000

function preview(text: string): string {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number): { text: string; cut: boolean } {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) return { text, cut: false }
  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const line = lines[i]!
    const size = Buffer.byteLength(line, "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) break
    out.unshift(line)
    bytes += size
  }
  return { text: out.join("\n"), cut: true }
}

export class ShellOutputBuffer {
  private chunks: Array<{ text: string; size: number }> = []
  private used = 0
  private last = ""
  private cut = false

  constructor(
    private readonly limits: {
      bytes: number
      lines: number
      keep: number
    },
  ) {}

  push(text: string, onPreview?: (preview: string) => void): void {
    const size = Buffer.byteLength(text, "utf-8")
    this.chunks.push({ text, size })
    this.used += size
    while (this.used > this.limits.keep && this.chunks.length > 1) {
      const item = this.chunks.shift()
      if (!item) break
      this.used -= item.size
      this.cut = true
    }
    this.last = preview(this.last + text)
    onPreview?.(this.last)
  }

  latest(): string {
    return this.last
  }

  format(input: {
    expired: boolean
    aborted: boolean
    timeout: number
    writeFullOutput: (text: string) => Effect.Effect<string>
  }) {
    const raw = this.chunks.map((item) => item.text).join("")
    const end = tail(raw, this.limits.lines, this.limits.bytes)
    if (end.cut) this.cut = true
    const outputPathRequired = end.cut

    return (outputPathRequired ? input.writeFullOutput(raw) : Effect.succeed("")).pipe(
      Effect.map((file) => {
        let output = end.text || "(no output)"
        const meta: string[] = []
        if (input.expired) {
          meta.push(
            `bash tool terminated command after exceeding timeout ${input.timeout} ms, retry with a larger timeout value in milliseconds.`,
          )
        }
        if (input.aborted) meta.push("User aborted the command")
        if (this.cut && file) output = `...output truncated...\n\nFull output saved to: ${file}\n\n${output}`
        if (meta.length > 0) output += "\n\n<bash_metadata>\n" + meta.join("\n") + "\n</bash_metadata>"

        return {
          output,
          latest: this.latest(),
          metadataOutput: this.latest() || preview(output),
          truncated: this.cut,
          outputPath: this.cut && file ? file : undefined,
        }
      }),
    )
  }
}
