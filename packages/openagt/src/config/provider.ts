import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const PositiveInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))

export const Model = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  release_date: Schema.optional(Schema.String),
  attachment: Schema.optional(Schema.Boolean),
  reasoning: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Boolean),
  tool_call: Schema.optional(Schema.Boolean),
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(
    Schema.Struct({
      input: Schema.Number,
      output: Schema.Number,
      cache_read: Schema.optional(Schema.Number),
      cache_write: Schema.optional(Schema.Number),
      context_over_200k: Schema.optional(
        Schema.Struct({
          input: Schema.Number,
          output: Schema.Number,
          cache_read: Schema.optional(Schema.Number),
          cache_write: Schema.optional(Schema.Number),
        }),
      ),
    }),
  ),
  limit: Schema.optional(
    Schema.Struct({
      context: Schema.Number,
      input: Schema.optional(Schema.Number),
      output: Schema.Number,
    }),
  ),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.mutable(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"]))),
      output: Schema.mutable(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"]))),
    }),
  ),
  experimental: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Literals(["alpha", "beta", "deprecated"])),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  variants: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.StructWithRest(
        Schema.Struct({
          disabled: Schema.optional(Schema.Boolean).annotate({ description: "Disable this variant for the model" }),
        }),
        [Schema.Record(Schema.String, Schema.Any)],
      ),
    ).annotate({ description: "Variant-specific configuration" }),
  ),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export class Info extends Schema.Class<Info>("ProviderConfig")({
  api: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  env: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  id: Schema.optional(Schema.String),
  npm: Schema.optional(Schema.String),
  whitelist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  blacklist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  fallback: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({ description: "Enable fallback on error" }),
      chain: Schema.optional(
        Schema.mutable(
          Schema.Array(
            Schema.Struct({
              provider: Schema.String,
              model: Schema.String,
            }),
          ),
        ),
      ).annotate({ description: "Ordered fallback chain: each entry is provider/model to try next" }),
      provider: Schema.optional(Schema.String).annotate({ description: "Fallback provider ID" }),
      model: Schema.optional(Schema.String).annotate({ description: "Fallback model ID" }),
      retryOnRateLimit: Schema.optional(Schema.Boolean).annotate({ description: "Fallback on rate limit (default: true)" }),
      retryOnServerError: Schema.optional(Schema.Boolean).annotate({ description: "Fallback on 5xx errors (default: true)" }),
      maxRetries: Schema.optional(PositiveInt).annotate({
        description: "Maximum fallback hops for a single request (default: 3)",
      }),
      retryPolicy: Schema.optional(
        Schema.Struct({
          baseDelayMs: Schema.optional(PositiveInt).annotate({
            description: "Initial retry delay in ms (default: 1000)",
          }),
          maxDelayMs: Schema.optional(PositiveInt).annotate({
            description: "Maximum retry delay in ms (default: 30000)",
          }),
          jitterFactor: Schema.optional(Schema.Number).annotate({
            description: "Random jitter factor 0-1 (default: 0.3)",
          }),
          circuitBreakerThreshold: Schema.optional(PositiveInt).annotate({
            description: "Consecutive failures before skipping provider (default: 5)",
          }),
          circuitBreakerResetMs: Schema.optional(PositiveInt).annotate({
            description: "Circuit breaker reset time in ms (default: 60000)",
          }),
        }),
      ).annotate({ description: "Retry policy: exponential backoff, jitter, and circuit breaker" }),
    }),
  ).annotate({ description: "Fallback provider configuration for automatic failover" }),
  options: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        apiKey: Schema.optional(Schema.String),
        baseURL: Schema.optional(Schema.String),
        enterpriseUrl: Schema.optional(Schema.String).annotate({
          description: "GitHub Enterprise URL for copilot authentication",
        }),
        setCacheKey: Schema.optional(Schema.Boolean).annotate({
          description: "Enable promptCacheKey for this provider (default false)",
        }),
        timeout: Schema.optional(
          Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
            description:
              "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
          }),
        ).annotate({
          description:
            "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
        }),
        chunkTimeout: Schema.optional(PositiveInt).annotate({
          description:
            "Timeout in milliseconds between streamed SSE chunks for this provider. If no chunk arrives within this window, the request is aborted.",
        }),
      }),
      [Schema.Record(Schema.String, Schema.Any)],
    ),
  ),
  models: Schema.optional(Schema.Record(Schema.String, Model)),
}) {
  static readonly zod = zod(this)
}

export * as ConfigProvider from "./provider"
