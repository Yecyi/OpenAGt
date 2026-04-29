import { Schema } from "effect"
import z from "zod"
import { Log } from "../util"
import { ZodOverride } from "@/util/effect-zod"
import { ConfigAgent } from "./agent"
import { ConfigCommand } from "./command"
import { ConfigExecPolicy } from "./exec-policy"
import { ConfigFormatter } from "./formatter"
import { ConfigLayout } from "./layout"
import { ConfigLSP } from "./lsp"
import { ConfigMCP } from "./mcp"
import { ConfigModelID } from "./model-id"
import { ConfigPermission } from "./permission"
import { ConfigPlugin } from "./plugin"
import { ConfigProvider } from "./provider"
import { ConfigServer } from "./server"
import { ConfigSkills } from "./skills"
import type { SandboxBackendPreference, SandboxFailurePolicy } from "@/sandbox/types"

// Schemas that still live at the zod layer (have .transform / .preprocess /
// .meta not expressible in current Effect Schema) get referenced via a
// ZodOverride-annotated Schema.Any.  Walker sees the annotation and emits the
// exact zod directly, preserving component $refs.
const AgentRef = Schema.Any.annotate({ [ZodOverride]: ConfigAgent.Info })
const PermissionRef = Schema.Any.annotate({ [ZodOverride]: ConfigPermission.Info })
const LogLevelRef = Schema.Any.annotate({ [ZodOverride]: Log.Level })

const PositiveInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))

export const InfoSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  logLevel: Schema.optional(LogLevelRef).annotate({ description: "Log level" }),
  server: Schema.optional(ConfigServer.Server).annotate({
    description: "Server configuration for openagt serve and web commands",
  }),
  command: Schema.optional(Schema.Record(Schema.String, ConfigCommand.Info)).annotate({
    description: "Command configuration",
  }),
  // Coordinator expert role definitions. Loaded from .opencode/experts/*.md
  // (mirrors agent/command loaders). Each entry MUST `inherits` from a builtin
  // CoordinatorNodeRole. Validation lives in ExpertRegistry — Config keeps the
  // value untyped here to avoid mixing zod and Effect Schema.
  expert: Schema.optional(Schema.Record(Schema.String, Schema.Any)).annotate({
    description: "Coordinator expert role definitions (loaded from .opencode/experts/*.md)",
  }),
  skills: Schema.optional(ConfigSkills.Info).annotate({ description: "Additional skill folder paths" }),
  watcher: Schema.optional(
    Schema.Struct({
      ignore: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    }),
  ),
  snapshot: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
  }),
  // User-facing plugin config is stored as Specs; provenance gets attached later while configs are merged.
  plugin: Schema.optional(Schema.mutable(Schema.Array(ConfigPlugin.Spec))),
  autoupdate: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal("notify")])).annotate({
    description:
      "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
  }),
  disabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Disable providers that are loaded automatically",
  }),
  enabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "When set, ONLY these providers will be enabled. All other providers will be ignored",
  }),
  model: Schema.optional(ConfigModelID).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  small_model: Schema.optional(ConfigModelID).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Custom username to display in conversations instead of system username",
  }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        build: Schema.optional(AgentRef),
        plan: Schema.optional(AgentRef),
      }),
      [Schema.Record(Schema.String, AgentRef)],
    ),
  ).annotate({ description: "@deprecated Use `agent` field instead." }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        // primary
        plan: Schema.optional(AgentRef),
        build: Schema.optional(AgentRef),
        // subagent
        general: Schema.optional(AgentRef),
        explore: Schema.optional(AgentRef),
        // specialized
        title: Schema.optional(AgentRef),
        summary: Schema.optional(AgentRef),
        compaction: Schema.optional(AgentRef),
      }),
      [Schema.Record(Schema.String, AgentRef)],
    ),
  ).annotate({ description: "Agent configuration" }),
  provider: Schema.optional(Schema.Record(Schema.String, ConfigProvider.Info)).annotate({
    description: "Custom provider configurations and model overrides",
  }),
  mcp: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([
        ConfigMCP.Info,
        // Matches the legacy `{ enabled: false }` form used to disable a server.
        Schema.Any.annotate({ [ZodOverride]: z.object({ enabled: z.boolean() }).strict() }),
      ]),
    ),
  ).annotate({ description: "MCP (Model Context Protocol) server configurations" }),
  formatter: Schema.optional(ConfigFormatter.Info),
  lsp: Schema.optional(ConfigLSP.Info),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional instruction files or patterns to include",
  }),
  layout: Schema.optional(ConfigLayout.Layout).annotate({ description: "@deprecated Always uses stretch layout." }),
  permission: Schema.optional(PermissionRef),
  exec_policy: Schema.optional(ConfigExecPolicy.Info).annotate({
    description: "Prefix-based shell execution policy rules that strengthen shell approvals and blocking.",
  }),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  enterprise: Schema.optional(
    Schema.Struct({
      url: Schema.optional(Schema.String).annotate({ description: "Enterprise URL" }),
    }),
  ),
  compaction: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description: "Enable automatic compaction when context is full (default: true)",
      }),
      prune: Schema.optional(Schema.Boolean).annotate({
        description: "Enable pruning of old tool outputs (default: true)",
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
      }),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      disable_paste_summary: Schema.optional(Schema.Boolean),
      batch_tool: Schema.optional(Schema.Boolean).annotate({ description: "Enable the batch tool" }),
      openTelemetry: Schema.optional(Schema.Boolean).annotate({
        description: "Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)",
      }),
      primary_tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Tools that should only be available to primary agents.",
      }),
      continue_loop_on_deny: Schema.optional(Schema.Boolean).annotate({
        description: "Continue the agent loop when a tool call is denied",
      }),
      mcp_timeout: Schema.optional(PositiveInt).annotate({
        description: "Timeout in milliseconds for model context protocol (MCP) requests",
      }),
      sandbox: Schema.optional(
        Schema.Struct({
          enabled: Schema.optional(Schema.Boolean),
          backend: Schema.optional(
            Schema.Literals([
              "auto",
              "seatbelt",
              "windows_native",
              "landlock",
              "process",
            ] satisfies SandboxBackendPreference[]),
          ),
          failure_policy: Schema.optional(
            Schema.Literals(["closed", "confirm_downgrade", "fallback"] satisfies SandboxFailurePolicy[]),
          ),
          report_only: Schema.optional(Schema.Boolean),
          broker_idle_ttl_ms: Schema.optional(PositiveInt),
        }),
      ),
      memory: Schema.optional(
        Schema.Struct({
          template: Schema.optional(Schema.String).annotate({ description: "Custom memory.md template path" }),
          maxTokens: Schema.optional(PositiveInt).annotate({ description: "Max tokens for memory.md (default: 4096)" }),
          trigger: Schema.optional(
            Schema.Struct({
              minimumMessageTokensToInit: Schema.optional(PositiveInt).annotate({
                description: "Initialize memory after N tokens (default: 6000)",
              }),
              minimumTokensBetweenUpdate: Schema.optional(PositiveInt).annotate({
                description: "Update memory after N additional tokens (default: 4000)",
              }),
              toolCallsBetweenUpdates: Schema.optional(PositiveInt).annotate({
                description: "Update memory after N tool calls (default: 10)",
              }),
            }),
          ),
        }),
      ).annotate({ description: "Session memory configuration" }),
      toolQuality: Schema.optional(
        Schema.Struct({
          weights: Schema.optional(
            Schema.Struct({
              hasValidSchema: Schema.optional(NonNegativeInt).annotate({
                description: "Score for valid schema (default: 20)",
              }),
              hasDescription: Schema.optional(NonNegativeInt).annotate({
                description: "Score for description (default: 15)",
              }),
              hasParameterDescriptions: Schema.optional(NonNegativeInt).annotate({
                description: "Score for parameter descriptions (default: 20)",
              }),
              hasReturnTypeDescription: Schema.optional(NonNegativeInt).annotate({
                description: "Score for return type description (default: 10)",
              }),
              hasExamples: Schema.optional(NonNegativeInt).annotate({
                description: "Score for examples (default: 10)",
              }),
              hasVersion: Schema.optional(NonNegativeInt).annotate({ description: "Score for version (default: 5)" }),
              isNamingConsistent: Schema.optional(NonNegativeInt).annotate({
                description: "Score for consistent naming (default: 10)",
              }),
              hasDeprecationWarning: Schema.optional(NonNegativeInt).annotate({
                description: "Score for deprecation warning (default: 10)",
              }),
            }),
          ).annotate({ description: "Quality score weights for each checklist item" }),
        }),
      ).annotate({ description: "MCP tool quality scoring configuration" }),
    }),
  ),
})
