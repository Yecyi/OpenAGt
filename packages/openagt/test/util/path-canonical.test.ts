import { describe, expect, test } from "bun:test"
import { windowsSandboxPathIssue } from "../../src/util/path-canonical"

describe("windowsSandboxPathIssue", () => {
  test("allows normal Windows paths", () => {
    expect(windowsSandboxPathIssue("C:\\Users\\Administrator\\project\\file.txt", "win32")).toBeUndefined()
  })

  test("rejects alternate data stream paths on Windows", () => {
    expect(windowsSandboxPathIssue("C:\\Users\\Administrator\\project\\file.txt:hidden", "win32")).toContain(
      "alternate data stream",
    )
  })

  test("rejects 8.3 short-name paths on Windows", () => {
    expect(windowsSandboxPathIssue("C:\\PROGRA~1\\OpenAGt\\openagt.exe", "win32")).toContain("8.3")
  })

  test("does not treat drive letters as alternate data streams", () => {
    expect(windowsSandboxPathIssue("C:\\", "win32")).toBeUndefined()
  })

  test("rejects NUL bytes on every platform", () => {
    expect(windowsSandboxPathIssue("safe\0bad", "linux")).toContain("NUL")
  })
})
