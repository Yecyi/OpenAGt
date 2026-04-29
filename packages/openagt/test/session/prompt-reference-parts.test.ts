import path from "path"
import { fileURLToPath } from "url"
import { describe, expect, test } from "bun:test"
import { promptReferenceFilePart, promptReferencePath } from "../../src/session/prompt/reference-parts"

describe("prompt reference parts", () => {
  test("resolves worktree-relative and home-relative references", () => {
    const worktree = path.resolve("repo")
    const home = path.resolve("home")

    expect(promptReferencePath({ name: "src/index.ts", worktree, homeDir: () => home })).toBe(
      path.resolve(worktree, "src/index.ts"),
    )
    expect(promptReferencePath({ name: "~/notes.txt", worktree, homeDir: () => home })).toBe(
      path.join(home, "notes.txt"),
    )
  })

  test("builds URL-encoded file parts and directory MIME", () => {
    const filepath = path.join(path.resolve("repo"), "file#name.txt")
    const file = promptReferenceFilePart({ name: "file#name.txt", filepath, fileType: "File" })
    const directory = promptReferenceFilePart({ name: "docs", filepath: path.resolve("docs"), fileType: "Directory" })

    expect(file.filename).toBe("file#name.txt")
    expect(file.url).toContain("%23")
    expect(fileURLToPath(file.url)).toBe(filepath)
    expect(file.mime).toBe("text/plain")
    expect(directory.mime).toBe("application/x-directory")
  })
})
