# OpenAGt Stable Install

OpenAGt `v1.16.0` stable covers:

- CLI / TUI
- headless server
- JavaScript SDK

Flutter is not part of this release line.

The current candidate line is `v1.17.0-rc.3`, which contains task/subagent visibility, release automation hardening, and an improved Windows installer flow. Treat it as an RC until it is promoted to GA.

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

Installer behavior:

- newer MSI versions upgrade the previous OpenAGt install that uses the same upgrade identity
- same-version RC installers are allowed to upgrade previous RC installs
- rerunning the same MSI version enters the standard Windows repair / maintenance flow
- the installer lets the user choose the install folder
- `GETTING_STARTED.txt` is installed in the OpenAGt folder and exposed through the Start Menu
- `openagt` and `opencode` are added to PATH

After installing or upgrading the MSI, open a new terminal and run:

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

Release maintainers can run the current local release gate with:

```bash
bun run verify:v1.17
```
