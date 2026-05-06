import { Bus } from "@/bus"
import { Event as BehaviorEvent } from "@/bus/behavior-events"
import { InstanceState } from "@/effect"
import { PermissionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage"
import { Log, Wildcard } from "@/util"
import { Cause, Context, Deferred, Effect, Layer, Schema } from "effect"
import { truncateForAudit, writeAuditLog } from "./audit"
import { CorrectedError, DeniedError, RejectedError, Request } from "./contracts"
import type { AskInput, Error, Reply, ReplyInput, Rule, Ruleset } from "./contracts"
import { Event } from "./events"
import { evaluate as evalRule } from "./evaluate"
import { PermissionID } from "./schema"

const log = Log.create({ service: "permission" })

// Wave 6: behavior.permission.decided emission. Publish errors are ignored
// because the audit stream is best-effort observability and must not block
// the permission reply path on bus backpressure.
function publishBehaviorDecision(bus: Bus.Interface, request: Request, reply: Reply, cascade: boolean) {
  return bus
    .publish(BehaviorEvent.PermissionDecided, {
      request_id: String(request.id),
      session_id: String(request.sessionID),
      action: reply,
      pattern: request.patterns[0],
      risk_level: typeof request.metadata?.riskLevel === "string" ? request.metadata.riskLevel : undefined,
      cascade,
    })
    .pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() =>
          log.warn("behavior event publish failed", {
            event: "permission.decided",
            request_id: String(request.id),
            action: reply,
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    )
}

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, Error>
  readonly reply: (input: ReplyInput) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
}

interface State {
  pending: Map<PermissionID, PendingEntry>
  approved: Ruleset
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  log.info("evaluate", { permission, pattern, ruleset: rulesets.flat() })
  return evalRule(permission, pattern, ...rulesets)
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        const row = Database.use((db) =>
          db.select().from(PermissionTable).where(eq(PermissionTable.project_id, ctx.project.id)).get(),
        )
        const state = {
          pending: new Map<PermissionID, PendingEntry>(),
          approved: row?.data ?? [],
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const { ruleset, ...request } = input
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny") {
          return yield* new DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }
        if (rule.action === "allow") continue
        needsAsk = true
      }

      if (!needsAsk) return

      const id = request.id ?? PermissionID.ascending()
      const info = Schema.decodeUnknownSync(Request)({
        id,
        ...request,
      })
      log.info("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
      pending.set(id, { info, deferred })
      yield* bus.publish(Event.Asked, info)
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return

      pending.delete(input.requestID)
      yield* bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })
      yield* publishBehaviorDecision(bus, existing.info, input.reply, false)

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* bus.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* publishBehaviorDecision(bus, item.info, "reject", true)
          yield* Deferred.fail(item.deferred, new RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      for (const pattern of existing.info.always) {
        approved.push({
          permission: existing.info.permission,
          pattern,
          action: "allow",
        })
        yield* Effect.promise(() =>
          writeAuditLog({
            timestamp: Date.now(),
            sessionID: existing.info.sessionID,
            agent: existing.info.metadata?.agent as string | undefined,
            pattern,
            riskLevel: existing.info.metadata?.riskLevel as string | undefined,
            commandSample: truncateForAudit(existing.info.metadata?.command as string | undefined),
          }),
        )
      }

      const approvedSnapshot = [...approved]
      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok = item.info.patterns.every(
          (pattern) => evaluate(item.info.permission, pattern, approvedSnapshot).action === "allow",
        )
        if (!ok) continue
        pending.delete(id)
        yield* bus.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        yield* publishBehaviorDecision(bus, item.info, "always", true)
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, reply, list })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * from "./config-rules"
export * from "./contracts"
export * from "./events"
export * as Permission from "."
