# OpenAGt Stable Install

OpenAGt `v1.16.0` stable covers:

- CLI / TUI
- headless server
- JavaScript SDK

Flutter is not part of this release line.

## Release Assets

- `openagt-windows-x64.zip`
- `OpenAGt-Setup-x64.msi`
- `openagt-linux-x64.tar.gz`
- `openagt-macos-arm64.tar.gz`
- `openagt-macos-x64.tar.gz`
- `SHA256SUMS.txt`
- SBOM

## Windows

Preferred install path:

- `OpenAGt-Setup-x64.msi`

After installing the MSI, open a new terminal and run:

```powershell
openagt
```

Compatibility alias:

```powershell
opencode
```

Portable install path:

- extract `openagt-windows-x64.zip`

Main entrypoints inside the archive:

- `bin\\openagt.exe`
- `bin\\openagt.cmd`
- `bin\\opencode.cmd`

## macOS / Linux

Extract the matching archive, then run:

```bash
./bin/openagt --help
./bin/opencode --help
```

## Run From Source

```bash
bun install
bun run --cwd packages/sdk/js script/build.ts
bun run --cwd packages/openagt src/index.ts --help
```

## Verification

Check the downloaded asset against `SHA256SUMS.txt` before installation.

Runtime diagnostics:

```powershell
openagt debug doctor
openagt debug bundle --session <id>
```

Release maintainers can run the local v1.16 gate with:

```bash
bun run verify:v1.16
```
