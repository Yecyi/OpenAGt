#!/usr/bin/env bun

import path from "path"
import { parseArgs } from "util"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    version: { type: "string" },
    output: { type: "string" },
    kind: { type: "string", default: "ga" },
  },
})

const version = values.version ?? "1.17.0"
const input = path.join(process.cwd(), "docs", "releases", `v${version}.md`)
const output = values.output ?? path.join(process.cwd(), "dist", `release-notes-v${version}.md`)
const kindLabel = values.kind === "rc" ? "Release Candidate" : "Stable Release"
const header = `# OpenAGt v${version} ${kindLabel}\n\n`
const body = (
  await Bun.file(input)
    .text()
    .catch(() => "")
).trim()

if (!body) {
  throw new Error(`Release notes template not found or empty: ${input}`)
}

await Bun.write(output, `${header}${body}\n`)
console.log(`Wrote release notes: ${output}`)
