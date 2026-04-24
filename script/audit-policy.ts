const bannedPackageSpecs = [
  {
    label: "@solidjs/start remote PR snapshot",
    pattern: /pkg\.pr\.new\/@solidjs\/start@dfb2020/,
    message: "Use the vendored @solidjs/start workspace package instead of the remote PR snapshot.",
  },
  {
    label: "vulnerable h3 release",
    pattern: /h3@2\.0\.1-rc\.4/,
    message: "h3@2.0.1-rc.4 is vulnerable; the vendored SolidStart package must resolve h3 to 2.0.1-rc.20.",
  },
  {
    label: "vulnerable srvx release",
    pattern: /srvx@0\.9\./,
    message: "srvx@0.9.x is vulnerable; the vendored SolidStart package must resolve srvx to 0.11.13 or newer.",
  },
] as const

const rootPackage = await Bun.file("package.json").text()
const lockfile = await Bun.file("bun.lock").text()

const findings = bannedPackageSpecs.flatMap((entry) => {
  const targets = [
    { name: "package.json", text: rootPackage },
    { name: "bun.lock", text: lockfile },
  ]

  return targets
    .filter((target) => entry.pattern.test(target.text))
    .map((target) => `${target.name}: banned ${entry.label}. ${entry.message}`)
})

if (findings.length === 0) {
  console.log("Audit policy check passed.")
  process.exit(0)
}

for (const finding of findings) {
  console.error(finding)
}

console.error(`Audit policy check failed with ${findings.length} finding(s).`)
process.exit(1)
