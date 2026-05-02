import { describe, expect, test } from "bun:test"
import path from "path"
import {
  FRAMEWORK_EXCEPTIONS,
  RULES,
  normalizeImportPath,
  parseImportLine,
  scanText,
} from "../../../../script/audit-tool-imports"

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..")

describe("script/audit-tool-imports", () => {
  describe("normalizeImportPath", () => {
    test("strips @/ alias", () => {
      expect(normalizeImportPath("@/personal/personal")).toBe("personal/personal")
    })
    test("strips relative prefixes", () => {
      expect(normalizeImportPath("../personal/personal")).toBe("personal/personal")
      expect(normalizeImportPath("../../personal/personal")).toBe("personal/personal")
      expect(normalizeImportPath("./personal/personal")).toBe("personal/personal")
    })
    test("strips file extensions", () => {
      expect(normalizeImportPath("../personal/personal.ts")).toBe("personal/personal")
      expect(normalizeImportPath("../personal/personal.js")).toBe("personal/personal")
    })
    test("leaves bare module specifiers alone (and preserves @scope/ prefix on npm packages)", () => {
      expect(normalizeImportPath("effect")).toBe("effect")
      // @scope/pkg is a real npm-style scope, not the @/ src-alias — keep it intact.
      expect(normalizeImportPath("@openagt/shared/util/error")).toBe("@openagt/shared/util/error")
    })
  })

  describe("parseImportLine", () => {
    test("detects value imports", () => {
      const r = parseImportLine('import { foo } from "../bar"')
      expect(r).toEqual({ spec: "../bar", isTypeOnly: false })
    })
    test("detects type-only imports", () => {
      const r = parseImportLine('import type { Foo } from "../bar"')
      expect(r).toEqual({ spec: "../bar", isTypeOnly: true })
    })
    test("returns null for non-import lines", () => {
      expect(parseImportLine("const x = 1")).toBeNull()
      expect(parseImportLine("// import { foo } from 'bar'")).toBeNull()
    })
  })

  describe("scanText regression — fixture flags every block rule", () => {
    test("the fixture file at script/fixtures/tool-bad-import.ts triggers all expected rules", async () => {
      const fixtureRel = "script/fixtures/tool-bad-import.ts"
      const text = await Bun.file(path.join(repoRoot, fixtureRel)).text()
      const findings = scanText(fixtureRel, text)

      // The fixture imports ALL three banned modules in value form, plus a
      // type-only import (must NOT be flagged) and the allowed
      // personal/service alternative (must NOT be flagged).
      const flaggedRules = findings.map((f) => f.rule.id).toSorted()
      expect(flaggedRules).toEqual([
        "tool-import.agent-agent",
        "tool-import.coordinator-coordinator",
        "tool-import.personal-personal",
      ])

      // Block-severity violations must include both personal and coordinator.
      const blocked = findings.filter((f) => f.rule.severity === "block").map((f) => f.rule.id)
      expect(blocked.toSorted()).toEqual([
        "tool-import.coordinator-coordinator",
        "tool-import.personal-personal",
      ])

      // The type-only import line must NOT appear in any finding.
      const flaggedSpecs = findings.map((f) => f.importPath)
      const personalServiceFlags = flaggedSpecs.filter((s) => s.endsWith("/personal/service"))
      expect(personalServiceFlags).toEqual([])
    })

    test("framework-exception files are not scanned", () => {
      // Pretend the fixture lives at one of the exception paths — the scan
      // must short-circuit and produce zero findings even though the text
      // is full of banned imports.
      const exceptionPath = [...FRAMEWORK_EXCEPTIONS][0]
      const text = `import { Coordinator } from "../coordinator/coordinator"\n`
      expect(scanText(exceptionPath, text)).toEqual([])
    })

    test("RULES list documents every banned path used by the fixture (no orphans)", () => {
      const ruleBanned = new Set(RULES.map((r) => r.bannedPath))
      expect(ruleBanned.has("personal/personal")).toBe(true)
      expect(ruleBanned.has("coordinator/coordinator")).toBe(true)
      expect(ruleBanned.has("agent/agent")).toBe(true)
    })
  })
})
