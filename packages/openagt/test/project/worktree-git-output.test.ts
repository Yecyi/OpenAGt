import { describe, expect, test } from "bun:test"
import { failedRemoves, parseWorktreeList, slugify } from "../../src/worktree/git-output"

describe("worktree git-output helpers", () => {
  test("slugify normalizes casing and punctuation", () => {
    expect(slugify(" My Feature Branch! ")).toBe("my-feature-branch")
    expect(slugify("---Already---Slugged---")).toBe("already-slugged")
    expect(slugify("release/v1.2.3")).toBe("release-v1-2-3")
  })

  test("parseWorktreeList parses porcelain output entries", () => {
    expect(
      parseWorktreeList(
        [
          "worktree C:/repo/main",
          "HEAD 1111111111111111111111111111111111111111",
          "branch refs/heads/main",
          "",
          "worktree C:/repo/worktree",
          "HEAD 2222222222222222222222222222222222222222",
          "branch refs/heads/opencode/demo",
          "",
          "worktree C:/repo/detached",
          "HEAD 3333333333333333333333333333333333333333",
        ].join("\n"),
      ),
    ).toEqual([
      { path: "C:/repo/main", branch: "refs/heads/main" },
      { path: "C:/repo/worktree", branch: "refs/heads/opencode/demo" },
      { path: "C:/repo/detached" },
    ])
  })

  test("failedRemoves extracts quoted and unquoted paths from output chunks", () => {
    expect(
      failedRemoves(
        "warning: failed to remove 'node_modules/pkg': Directory not empty\nother line",
        'warning: failed to remove "dist/app": Permission denied',
        "warning: failed to remove build/cache: Device or resource busy",
      ),
    ).toEqual(["node_modules/pkg", "dist/app", "build/cache"])
  })
})
