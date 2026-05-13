// Builds prompt reference paths and file parts from already-discovered @mentions.
// It does not scan markdown, stat the filesystem, or resolve agent fallbacks.
import path from "path"
import { pathToFileURL } from "url"

export type PromptReferenceFilePart = {
  type: "file"
  url: string
  filename: string
  mime: "application/x-directory" | "text/plain"
}

export function promptReferencePath(input: { name: string; worktree: string; homeDir: () => string }): string {
  if (input.name.startsWith("~/")) return path.join(input.homeDir(), input.name.slice(2))
  return path.resolve(input.worktree, input.name)
}

export function promptReferenceFilePart(input: {
  name: string
  filepath: string
  fileType: string
}): PromptReferenceFilePart {
  return {
    type: "file",
    url: pathToFileURL(input.filepath).href,
    filename: input.name,
    mime: input.fileType === "Directory" ? "application/x-directory" : "text/plain",
  }
}
