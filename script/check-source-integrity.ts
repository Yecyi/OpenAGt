const mojibakePatterns = [
  { label: "mojibake token U+95B3?", pattern: /\u95b3\?/u },
  { label: "mojibake token U+95B4?", pattern: /\u95b4\?/u },
  { label: "mojibake token U+61C7U+9227", pattern: /\u61c7\u9227/u },
  { label: "mojibake token U+9225?", pattern: /\u9225\?/u },
  { label: "mojibake token U+922B?", pattern: /\u922b\?/u },
  { label: "mojibake token U+923C?", pattern: /\u923c\?/u },
  { label: "mojibake token U+9239?", pattern: /\u9239\?/u },
  { label: "mojibake token U+923F?", pattern: /\u923f\?/u },
  { label: "mojibake token U+9241?", pattern: /\u9241\?/u },
  { label: "replacement character U+FFFD", pattern: /\uFFFD/u },
] as const

const sourceFiles = (
  await Promise.all(
    ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx", "packages/**/src/**/*.d.ts"].map((pattern) =>
      Array.fromAsync(new Bun.Glob(pattern).scan()),
    ),
  )
).flat()

const scriptFiles = (
  await Promise.all(
    ["script/**/*.ts", "script/**/*.tsx", "*.ts"].map((pattern) => Array.fromAsync(new Bun.Glob(pattern).scan())),
  )
).flat()

const files = Array.from(new Set([...sourceFiles, ...scriptFiles])).sort()

const findings = (
  await Promise.all(
    files.map(async (filepath) => {
      const text = await Bun.file(filepath).text()
      const issues = text.split(/\r?\n/).flatMap((line, index) =>
        mojibakePatterns.flatMap((entry) => {
          if (!entry.pattern.test(line)) return []
          return [
            {
              filepath,
              line: index + 1,
              message: entry.label,
            },
          ]
        }),
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
