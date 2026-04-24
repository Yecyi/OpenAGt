# SolidStart Vendor Policy

OpenAG temporarily vendors the `@solidjs/start` PR snapshot used by the console and enterprise apps.

The vendor package keeps the current SolidStart runtime behavior while replacing vulnerable transitive dependencies that were pinned by the remote `pkg.pr.new` package metadata:

- `h3@2.0.1-rc.4` -> `h3@2.0.1-rc.20`
- `srvx@0.9.x` -> `srvx@0.11.13` or newer

Do not switch the root catalog entry back to `https://pkg.pr.new/@solidjs/start@dfb2020`. The `check:audit-policy` script blocks that URL and the known vulnerable lockfile entries.

Long term, migrate `packages/console/app` and `packages/enterprise` to a formal `@solidjs/start@1.3.2+` release. That migration must replace the current Vite `solidStart()` plugin config with Vinxi `defineConfig()` app config and replace `@solidjs/start/http` session usage with a local cookie/session helper.
