// Wave 6 — unified behavior audit stream.
//
// Per the LLM-behavior research (CoT faithfulness 25-39% on misaligned hints,
// reasoning trace is leaky as an audit signal): action-level audit must come
// from observable behavior, not from the model's stated reasoning. This file
// declares the event taxonomy that lets a downstream consumer reconstruct
// what the agent actually DID — tool invocations, permission decisions,
// memory injections, sub-agent dispatch, file touches — independent of what
// the agent said it would do.
//
// Existing event families like `provider.fallback.hop`, `tools.changed`,
// `permission.asked/replied`, `File.Event.Edited`, and the coordinator
// `publishUpdated` signal each capture a slice. The behavior.* family wraps
// these into a single observable stream with consistent correlation IDs
// (session_id, message_id, tool_call_id) so downstream observers can
// reconstruct an action timeline without joining across event families.
//
// Persistence is opt-in via OPENAGT_BEHAVIOR_AUDIT to avoid forcing event-
// buffer disk I/O on every tool call by default. SSE consumers can subscribe
// in-memory regardless of persistence.

import { BusEvent } from "./bus-event"
import z from "zod"

// behavior.tool.invoked — fires when a tool call starts execution. Pairs
// with behavior.tool.completed via tool_call_id.
export const ToolInvoked = BusEvent.define(
  "behavior.tool.invoked",
  z.object({
    tool_id: z.string(),
    tool_call_id: z.string(),
    session_id: z.string(),
    message_id: z.string(),
    args_hash: z.string(),
    started_at: z.number(),
    agent: z.string().optional(),
  }),
)

// behavior.tool.completed — fires when the tool call ends, success or fail.
// `success: false` means the tool returned a structured error or raised.
// `output_size` is the byte length of the model-facing output string.
export const ToolCompleted = BusEvent.define(
  "behavior.tool.completed",
  z.object({
    tool_id: z.string(),
    tool_call_id: z.string(),
    session_id: z.string(),
    message_id: z.string(),
    success: z.boolean(),
    output_size: z.number().int().min(0),
    duration_ms: z.number().int().min(0),
    error_kind: z.string().optional(),
  }),
)

// behavior.permission.decided — wraps permission.replied with the
// permission/contracts.ts `Reply` value flattened. "once" means approved
// for this call only; "always" means approved + persisted to allow-list;
// "reject" means denied (and any sibling pending requests in the same
// session are also rejected). cascade=true marks the secondary rejections
// emitted automatically when the original reject cascades.
export const PermissionDecided = BusEvent.define(
  "behavior.permission.decided",
  z.object({
    request_id: z.string(),
    session_id: z.string(),
    action: z.enum(["once", "always", "reject"]),
    pattern: z.string().optional(),
    risk_level: z.string().optional(),
    cascade: z.boolean().default(false),
  }),
)

// behavior.memory.injected — fires when personal memory notes are attached
// to a session/plan context. kind_breakdown lets a downstream consumer track
// which memory kinds are flowing into which sessions over time without
// dereferencing every note_id.
export const MemoryInjected = BusEvent.define(
  "behavior.memory.injected",
  z.object({
    session_id: z.string(),
    plan_id: z.string().optional(),
    note_ids: z.array(z.string()),
    kind_breakdown: z.object({
      fact: z.number().int().min(0).default(0),
      preference: z.number().int().min(0).default(0),
      belief: z.number().int().min(0).default(0),
    }),
    source: z.enum(["plan_enrichment", "search_tool", "manual"]).default("plan_enrichment"),
  }),
)

// behavior.subagent.dispatched — fires when a CoordinatorNode becomes a
// concrete subagent session. Captures the isolation_level (Wave 5's
// personal_memory_access) so the audit stream records what context
// guardrails were in effect for the dispatched session.
export const SubagentDispatched = BusEvent.define(
  "behavior.subagent.dispatched",
  z.object({
    parent_session_id: z.string(),
    child_session_id: z.string(),
    node_id: z.string(),
    agent: z.string(),
    role: z.string().optional(),
    isolation_level: z.enum(["full", "facts_only", "blind"]).default("full"),
    goal_hash: z.string(),
    started_at: z.number(),
  }),
)

// behavior.file.touched — wraps the existing File.Event.Edited / FileWatcher
// events into the behavior stream so a single consumer can reconstruct the
// agent's filesystem footprint without joining cross-family events.
export const FileTouched = BusEvent.define(
  "behavior.file.touched",
  z.object({
    path: z.string(),
    kind: z.enum(["read", "write", "edit", "patch"]),
    session_id: z.string(),
    tool_call_id: z.string().optional(),
    bytes: z.number().int().min(0).optional(),
  }),
)

export const Event = {
  ToolInvoked,
  ToolCompleted,
  PermissionDecided,
  MemoryInjected,
  SubagentDispatched,
  FileTouched,
}

// Type list used by bus persistence to gate behavior.* into the disk buffer
// when OPENAGT_BEHAVIOR_AUDIT=1 is set. See bus/index.ts CRITICAL_EVENT_TYPES.
export const BEHAVIOR_EVENT_TYPES = [
  "behavior.tool.invoked",
  "behavior.tool.completed",
  "behavior.permission.decided",
  "behavior.memory.injected",
  "behavior.subagent.dispatched",
  "behavior.file.touched",
] as const
