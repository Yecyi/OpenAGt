#!/usr/bin/env bun

import { $ } from "bun"

await $`bun dev generate`
  .cwd("packages/openagt")
  .text()
  .then((value) => Bun.write("packages/sdk/openapi.json", value))

await $`bun ./packages/sdk/js/script/build.ts`

await $`./script/format.ts`
