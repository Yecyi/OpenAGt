#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

await import("./generate.ts")

import { Script } from "@openagt/script"
import pkg from "../package.json"

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const archiveFlag = process.argv.includes("--archive")
const noUploadFlag = process.argv.includes("--no-upload")
const plugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")
const releaseBuild = Script.release || archiveFlag

function archiveName(input: { os: string; arch: "arm64" | "x64" }) {
  const os = input.os === "darwin" ? "macos" : input.os === "win32" ? "windows" : input.os
  return `${pkg.name}-${os}-${input.arch}`
}

async function builtBinaryPath(name: string) {
  const candidates = [`dist/${name}/bin/openagt`, `dist/${name}/bin/openagt.exe`]
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  throw new Error(`Unable to locate built binary for ${name}`)
}

function releaseReadme(input: { name: string; os: string; arch: "arm64" | "x64" }) {
  return [
    `OpenAGt ${Script.version}`,
    ``,
    `Package: ${input.name}`,
    `Platform: ${input.os}`,
    `Architecture: ${input.arch}`,
    ``,
    `Quick start:`,
    input.os === "win32" ? `  .\\bin\\openagt.cmd` : `  ./bin/openagt`,
    input.os === "win32" ? `  .\\bin\\openagt.cmd --help` : `  ./bin/openagt --help`,
    input.os === "win32" ? `  .\\bin\\opencode.cmd --help` : `  ./bin/opencode --help`,
    ``,
    `Installed Windows MSI users should open a new terminal and run: openagt`,
    ``,
    `This stable release covers the CLI, TUI, and headless server runtime.`,
    `Flutter is not included in this support matrix.`,
  ].join("\n")
}

async function createReleasePackage(input: { name: string; os: string; arch: "arm64" | "x64" }) {
  const releaseDir = `dist/${input.name}/release`
  const binDir = `${releaseDir}/bin`
  await $`rm -rf ${releaseDir}`
  await $`mkdir -p ${binDir}`
  const sourceBinary = await builtBinaryPath(input.name)
  const binaryName = input.os === "win32" ? "openagt.exe" : "openagt"
  await fs.promises.copyFile(sourceBinary, path.join(binDir, binaryName))
  if (input.os === "win32") {
    await Bun.write(
      path.join(binDir, "openagt.cmd"),
      `@echo off\r\nset SCRIPT_DIR=%~dp0\r\n"%SCRIPT_DIR%openagt.exe" %*\r\n`,
    )
    await Bun.write(
      path.join(binDir, "opencode.cmd"),
      `@echo off\r\nset SCRIPT_DIR=%~dp0\r\n"%SCRIPT_DIR%openagt.exe" %*\r\n`,
    )
  } else {
    await Bun.write(
      path.join(binDir, "opencode"),
      `#!/usr/bin/env sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$DIR/openagt" "$@"\n`,
    )
    await Promise.all([
      fs.promises.chmod(path.join(binDir, "openagt"), 0o755),
      fs.promises.chmod(path.join(binDir, "opencode"), 0o755),
    ])
  }
  await Bun.write(path.join(releaseDir, "README.txt"), releaseReadme(input))
  await Bun.write(path.join(releaseDir, "VERSION.txt"), `${Script.version}\n`)
  await Bun.write(path.join(releaseDir, "LICENSE"), await Bun.file("../../LICENSE").text())
  return releaseDir
}

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const releaseTargets = allTargets.filter(
  (item) =>
    item.abi === undefined &&
    item.avx2 !== false &&
    ((item.os === "linux" && item.arch === "x64") ||
      (item.os === "darwin" && (item.arch === "x64" || item.arch === "arm64")) ||
      (item.os === "win32" && item.arch === "x64")),
)

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : releaseBuild
    ? releaseTargets
    : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun add --no-save --exact --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun add --no-save --exact --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/cmd/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/openagt`,
      execArgv: [`--user-agent=openagt/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: embeddedFileMap ? { "openagt-web-ui.gen.ts": embeddedFileMap } : {},
    entrypoints: ["./src/index.ts", parserWorker, workerPath, ...(embeddedFileMap ? ["openagt-web-ui.gen.ts"] : [])],
    define: {
      OPENAGT_VERSION: `'${Script.version}'`,
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MIGRATIONS: JSON.stringify(migrations),
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENAGT_CHANNEL: `'${Script.channel}'`,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = await builtBinaryPath(name)
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      if (!versionOutput.includes(Script.version)) {
        throw new Error(`Expected ${Script.version}, received ${versionOutput.trim()}`)
      }
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
  if (releaseBuild) {
    await createReleasePackage({
      name,
      os: item.os,
      arch: item.arch,
    })
  }
}

if (releaseBuild) {
  for (const key of Object.keys(binaries)) {
    const os = key.includes("windows") ? "win32" : key.includes("darwin") ? "darwin" : "linux"
    const arch = key.endsWith("arm64") ? "arm64" : "x64"
    const asset = archiveName({
      os,
      arch,
    })
    if (os === "win32") {
      const source = path.resolve(dir, `dist/${key}/release`)
      const target = path.resolve(dir, `dist/${asset}.zip`)
      await $`powershell -NoProfile -Command Compress-Archive -Path "${source}\\*" -DestinationPath "${target}" -Force`
      continue
    }
    await $`tar -czf ../../${asset}.tar.gz *`.cwd(`dist/${key}/release`)
  }
}

if (Script.release && !noUploadFlag) {
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz ./dist/*.msi --clobber --repo ${process.env.GH_REPO}`.nothrow()
}

export { binaries }
