const check = Bun.spawn(["oxlint", "--quiet", "--format", "json"], {
  stdout: "ignore",
  stderr: "pipe",
})

const stderr = await new Response(check.stderr).text()
const code = await check.exited

if (code === 0) process.exit(0)

if (stderr) process.stderr.write(stderr)

const report = Bun.spawn(["oxlint", "--quiet"], {
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await report.exited)
