#!/usr/bin/env bun

import { createHash } from "crypto"
import path from "path"
import { parseArgs } from "util"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    dir: { type: "string", default: "dist" },
    output: { type: "string" },
  },
})

const dir = path.resolve(process.cwd(), values.dir)
const output = path.resolve(process.cwd(), values.output ?? path.join(values.dir, "SHA256SUMS.txt"))
const files = (
  await Promise.all([
    Array.fromAsync(new Bun.Glob("*.zip").scan({ cwd: dir })),
    Array.fromAsync(new Bun.Glob("*.tar.gz").scan({ cwd: dir })),
    Array.fromAsync(new Bun.Glob("*.msi").scan({ cwd: dir })),
  ])
).flat()

const lines = await Promise.all(
  files.sort().map(async (file) => {
    const bytes = await Bun.file(path.join(dir, file)).bytes()
    const hash = createHash("sha256").update(bytes).digest("hex")
    return `${hash}  ${file}`
  }),
)

await Bun.write(output, `${lines.join("\n")}\n`)
console.log(`Wrote checksums: ${output}`)
