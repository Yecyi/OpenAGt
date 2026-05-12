#!/usr/bin/env bun

import { z } from "zod"
import path from "node:path"
import fs from "node:fs/promises"
import os from "node:os"

function generate(schema: z.ZodType) {
  const result = z.toJSONSchema(schema, {
    io: "input", // Generate input shape (treats optional().default() as not required)
    /**
     * We'll use the `default` values of the field as the only value in `examples`.
     * This will ensure no docs are needed to be read, as the configuration is
     * self-documenting.
     *
     * See https://json-schema.org/draft/2020-12/draft-bhutton-json-schema-validation-00#rfc.section.9.5
     */
    override(ctx) {
      const schema = ctx.jsonSchema

      // Preserve strictness: set additionalProperties: false for objects
      if (
        schema &&
        typeof schema === "object" &&
        schema.type === "object" &&
        schema.additionalProperties === undefined
      ) {
        schema.additionalProperties = false
      }

      // Add examples and default descriptions for string fields with defaults
      if (schema && typeof schema === "object" && "type" in schema && schema.type === "string" && schema?.default) {
        if (!schema.examples) {
          schema.examples = [schema.default]
        }

        schema.description = [schema.description || "", `default: \`${String(schema.default)}\``]
          .filter(Boolean)
          .join("\n\n")
          .trim()
      }
    },
  }) as Record<string, unknown> & {
    allowComments?: boolean
    allowTrailingCommas?: boolean
  }

  // used for json lsps since config supports jsonc
  result.allowComments = true
  result.allowTrailingCommas = true

  return result
}

const configFile = process.argv[2] ?? path.join(import.meta.dir, "..", "schema", "config.json")
const tuiFile = process.argv[3] ?? path.join(import.meta.dir, "..", "schema", "tui.json")
const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), "openagt-schema-home-"))

process.env.OPENAGT_TEST_HOME ??= isolatedHome
process.env.OPENCODE_TEST_HOME ??= isolatedHome
process.env.XDG_CONFIG_HOME ??= path.join(isolatedHome, ".config")
process.env.XDG_DATA_HOME ??= path.join(isolatedHome, ".local", "share")
process.env.XDG_STATE_HOME ??= path.join(isolatedHome, ".local", "state")
process.env.XDG_CACHE_HOME ??= path.join(isolatedHome, ".cache")

const { Config } = await import("../src/config")
const { TuiConfig } = await import("../src/cli/cmd/tui/config/tui")

console.log(configFile)
await fs.mkdir(path.dirname(configFile), { recursive: true })
await Bun.write(configFile, JSON.stringify(generate(Config.Info), null, 2))

if (tuiFile) {
  console.log(tuiFile)
  await fs.mkdir(path.dirname(tuiFile), { recursive: true })
  await Bun.write(tuiFile, JSON.stringify(generate(TuiConfig.Info), null, 2))
}

await fs.rm(isolatedHome, { recursive: true, force: true })
