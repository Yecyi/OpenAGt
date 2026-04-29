import { Schema } from "effect"
import z from "zod"
import { zod } from "@/util/effect-zod"
import { ConfigPlugin } from "./plugin"
import { InfoSchema } from "./info-schema"

// Schema.Struct produces readonly types by default, but the service code
// mutates Info objects directly. Strip readonly recursively while preserving
// unknown and tuple shapes used by config plugin specs.
type DeepMutable<T> = T extends readonly [unknown, ...unknown[]]
  ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
  : T extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T

// The walker emits non-strict objects; config historically rejects unknown
// properties, so strictness is layered on after schema derivation.
export const Info = (zod(InfoSchema) as unknown as z.ZodObject<any>)
  .strict()
  .meta({ ref: "Config" }) as unknown as z.ZodType<DeepMutable<Schema.Schema.Type<typeof InfoSchema>>>

export type Info = z.output<typeof Info> & {
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
}
