const mojibakeSignatures = ["閳", "閴", "懇鈧", "鈥?", "鈫?", "鉁?", "鈿?", "鈼?", "鈹?"]

const files = Array.from(
  new Set(
    (
      await Promise.all(
        ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx", "packages/**/src/**/*.d.ts"].map((pattern) =>
          Array.fromAsync(new Bun.Glob(pattern).scan()),
        ),
      )
    ).flat(),
  ),
).sort()

const findings = (
  await Promise.all(
    files.map(async (filepath) => {
      const text = await Bun.file(filepath).text()
      const issues = text
        .split(/\r?\n/)
        .flatMap((line, index) =>
          mojibakeSignatures
            .filter((signature) => line.includes(signature))
            .map((signature) => ({
              filepath,
              line: index + 1,
              message: `mojibake signature ${JSON.stringify(signature)}`,
            })),
        )

      const trimmed = text.trim()
      if (
        filepath.endsWith("custom-elements.d.ts") &&
        !trimmed.includes("\n") &&
        /^[.]{1,2}[\\/].+$/.test(trimmed) &&
        !trimmed.startsWith("///")
      ) {
        issues.push({
          filepath,
          line: 1,
          message: "bare relative path declaration shim",
        })
      }

      return issues
    }),
  )
).flat()

if (findings.length === 0) {
  console.log(`Integrity check passed for ${files.length} source files.`)
  process.exit(0)
}

for (const finding of findings) {
  console.error(`${finding.filepath}:${finding.line} ${finding.message}`)
}

console.error(`Integrity check failed with ${findings.length} finding(s).`)
process.exit(1)
