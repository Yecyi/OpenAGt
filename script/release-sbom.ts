#!/usr/bin/env bun

import path from "path"
import { parseArgs } from "util"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    output: { type: "string" },
  },
})

const root = process.cwd()
const rootPackage = await Bun.file(path.join(root, "package.json")).json()
const openagtPackage = await Bun.file(path.join(root, "packages", "openagt", "package.json")).json()
const sdkPackage = await Bun.file(path.join(root, "packages", "sdk", "js", "package.json")).json()
const now = new Date().toISOString()
const packages = [
  {
    name: "OpenAGt",
    SPDXID: "SPDXRef-Package-OpenAGt",
    versionInfo: openagtPackage.version,
    downloadLocation: "https://github.com/Yecyi/OpenAGt",
    filesAnalyzed: false,
    licenseConcluded: openagtPackage.license ?? "NOASSERTION",
    licenseDeclared: openagtPackage.license ?? "NOASSERTION",
    copyrightText: "NOASSERTION",
  },
  {
    name: "@openagt/sdk",
    SPDXID: "SPDXRef-Package-OpenAGt-SDK",
    versionInfo: sdkPackage.version,
    downloadLocation: "https://github.com/Yecyi/OpenAGt",
    filesAnalyzed: false,
    licenseConcluded: sdkPackage.license ?? "NOASSERTION",
    licenseDeclared: sdkPackage.license ?? "NOASSERTION",
    copyrightText: "NOASSERTION",
  },
]

await Bun.write(
  values.output ?? path.join(root, "dist", "sbom.spdx.json"),
  JSON.stringify(
    {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name: `OpenAGt-${openagtPackage.version}`,
      documentNamespace: `https://github.com/Yecyi/OpenAGt/releases/tag/v${openagtPackage.version}/sbom-${crypto.randomUUID()}`,
      creationInfo: {
        created: now,
        creators: ["Tool: OpenAGt release-sbom.ts", `PackageManager: ${rootPackage.packageManager ?? "unknown"}`],
      },
      packages,
      relationships: packages.map((item) => ({
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: item.SPDXID,
      })),
    },
    null,
    2,
  ) + "\n",
)
