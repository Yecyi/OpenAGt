const args = ["oxlint", "--quiet", "--ignore-pattern", ".claude/**"]

const check = Bun.spawn([...args, "--format", "json"], {
  stdout: "ignore",
  stderr: "pipe",
})

const stderr = await new Response(check.stderr).text()
const code = await check.exited

if (code === 0) process.exit(0)

if (stderr) process.stderr.write(stderr)

const report = Bun.spawn(args, {
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await report.exited)
