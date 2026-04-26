import { describe, expect, test } from "bun:test"
import { brokerCommand } from "../../src/sandbox/broker"
import { autoBackendName } from "../../src/sandbox/backends"

describe("brokerCommand", () => {
  test("restarts the packaged binary instead of resolving broker-main.ts", () => {
    expect(
      brokerCommand(["C:\\OpenAGt\\openagt.exe", "C:\\OpenAGt\\openagt.exe"], "C:\\OpenAGt\\openagt.exe", []),
    ).toEqual(["C:\\OpenAGt\\openagt.exe"])
  })

  test("keeps the source entry script when running from TypeScript", () => {
    expect(
      brokerCommand(["bun", "C:\\repo\\packages\\openagt\\src\\index.ts"], "C:\\Bun\\bun.exe", ["--smol"]),
    ).toEqual(["C:\\Bun\\bun.exe", "--smol", "C:\\repo\\packages\\openagt\\src\\index.ts"])
  })
})

describe("autoBackendName", () => {
  test("uses process backend for Windows auto sandbox", () => {
    expect(autoBackendName("win32")).toBe("process")
  })

  test("keeps native defaults for supported unix platforms", () => {
    expect(autoBackendName("darwin")).toBe("seatbelt")
    expect(autoBackendName("linux")).toBe("landlock")
  })
})
