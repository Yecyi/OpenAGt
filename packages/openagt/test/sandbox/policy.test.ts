import { describe, expect, test } from "bun:test"
import path from "path"
import { resolvePathScopes } from "../../src/sandbox/policy"

describe("resolvePathScopes", () => {
  test("keeps external paths allowed while separating native writable scope", () => {
    const cwd = path.resolve("workspace")
    const external = path.resolve("outside", "input.txt")
    const scopes = resolvePathScopes(cwd, [external], [path.resolve("instance"), path.resolve("worktree")])

    expect(scopes.allowed).toContain(external)
    expect(scopes.writable).not.toContain(external)
    expect(scopes.compatWritable).toContain(external)
    expect(scopes.writable).toContain(cwd)
  })
})
