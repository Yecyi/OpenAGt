import { BudgetTuning } from "@/agent/budget-tuning"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { Database, eq } from "@/storage"
import { Effect, Option } from "effect"
import { CoordinatorRunTable } from "./coordinator.sql"
import { addResourceLimit, capCheckpointReserve, checkpointReserveFor, scaleResourceLimit } from "./budget-governance"
import { capResourceLimit } from "./budget-policy"
import { CoordinatorEvents } from "./events"
import {
  planWithRuntimeState,
  continuationVelocityFor,
  resourceLimitDelta,
  resourceUsageFor,
  runtimeStateFor,
  taskLeaseFor,
} from "./runtime-state"
import { CoordinatorPlan, BudgetProfile, BudgetState, ResourceLimit } from "./schema"
import type {
  AutoContinuePolicy as AutoContinuePolicyType,
  CoordinatorRun as CoordinatorRunType,
  CoordinatorRunID as CoordinatorRunIDType,
} from "./schema"
import type { CoordinatorRunStore } from "./run-store"

export class CoordinatorRunMutations {
  constructor(
    private readonly deps: {
      tasks: TaskRuntime.Interface
      runStore: CoordinatorRunStore
      now: () => number
      ensureSubscribed: () => Effect.Effect<void, Error>
      get: (id: CoordinatorRunIDType) => Effect.Effect<Option.Option<CoordinatorRunType>, Error>
      relevantTasks: (run: CoordinatorRunType) => Effect.Effect<TaskRuntime.TaskRecord[], Error>
      dispatchReady: (id: CoordinatorRunIDType) => Effect.Effect<void, Error>
      publishUpdated: (run: CoordinatorRunType) => Effect.Effect<void, Error>
    },
  ) {}

  activateRun = Effect.fn("Coordinator.activateRun")(function* (
    this: CoordinatorRunMutations,
    id: CoordinatorRunIDType,
  ) {
    const runOpt = yield* this.deps.get(id)
    if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
    if (runOpt.value.state === "completed" || runOpt.value.state === "failed" || runOpt.value.state === "cancelled")
      return runOpt.value
    yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .update(CoordinatorRunTable)
          .set({
            state: "active",
            summary: "Coordinator run active",
            time_updated: this.deps.now(),
            time_finished: null,
          })
          .where(eq(CoordinatorRunTable.id, id))
          .run(),
      ),
    )
    const updated = yield* this.deps.runStore.readAfterUpdate(id)
    yield* this.deps.publishUpdated(updated)
    return updated
  })

  private reconcileStaleTasks = Effect.fn("Coordinator.reconcileStaleTasks")(function* (
    this: CoordinatorRunMutations,
    run: CoordinatorRunType,
  ) {
    const taskList = yield* this.deps.relevantTasks(run)
    const stale = taskList.filter((item) => taskLeaseFor(item).stale)
    if (stale.length === 0) return 0
    const tasks = this.deps.tasks
    yield* Effect.all(
      stale.map((item) =>
        tasks.partial({
          taskID: item.task_id,
          parentSessionID: item.parent_session_id,
          output: item.result_summary ?? item.error_summary ?? "Stale running task recovered before resume",
          reason: "Coordinator resume recovered a stale running task lease",
          retryable: true,
          remainingScope: item.acceptance_checks.length
            ? item.acceptance_checks
            : [...item.read_scope, ...item.write_scope],
        }),
      ),
      {
        concurrency: BudgetTuning.concurrency.storageRead,
        discard: true,
      },
    )
    return stale.length
  })

  approve = Effect.fn("Coordinator.approve")(function* (this: CoordinatorRunMutations, id: CoordinatorRunIDType) {
    yield* this.deps.ensureSubscribed()
    const current = yield* this.deps.get(id)
    if (Option.isNone(current)) throw new Error(`Coordinator run not found: ${id}`)
    if (current.value.state !== "awaiting_approval" && current.value.state !== "planned") {
      return yield* Effect.fail(new Error(`Coordinator run cannot be approved from state: ${current.value.state}`))
    }
    const activated = yield* this.activateRun(id)
    if (activated.state === "active") yield* this.deps.dispatchReady(id)
    const runOpt = yield* this.deps.get(id)
    if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
    return runOpt.value
  })

  cancel = Effect.fn("Coordinator.cancel")(function* (this: CoordinatorRunMutations, id: CoordinatorRunIDType) {
    yield* this.deps.ensureSubscribed()
    const runOpt = yield* this.deps.get(id)
    if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
    if (runOpt.value.state === "completed" || runOpt.value.state === "failed" || runOpt.value.state === "cancelled") {
      return yield* Effect.fail(new Error(`Coordinator run cannot be cancelled from state: ${runOpt.value.state}`))
    }
    const taskList = yield* this.deps.relevantTasks(runOpt.value)
    const prompt = yield* Effect.serviceOption(SessionPrompt.Service)
    const timestamp = this.deps.now()
    yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .update(CoordinatorRunTable)
          .set({
            state: "cancelled",
            summary: "Coordinator run cancelled",
            time_updated: timestamp,
            time_finished: timestamp,
          })
          .where(eq(CoordinatorRunTable.id, id))
          .run(),
      ),
    )
    const tasks = this.deps.tasks
    yield* Effect.all(
      taskList
        .filter((item) => item.status === "pending" || item.status === "running")
        .map((item) =>
          Effect.gen(function* () {
            if (item.status === "running" && Option.isSome(prompt)) {
              yield* prompt.value.cancel(item.child_session_id).pipe(Effect.ignore)
            }
            yield* tasks.cancel({
              taskID: item.task_id,
              parentSessionID: item.parent_session_id,
              reason: "Coordinator run cancelled",
            })
          }),
        ),
      {
        concurrency: BudgetTuning.concurrency.storageRead,
      },
    )
    const updated = yield* this.deps.runStore.readAfterUpdate(id)
    yield* this.deps.publishUpdated(updated)
    return updated
  })

  retry = Effect.fn("Coordinator.retry")(function* (
    this: CoordinatorRunMutations,
    input: { id: CoordinatorRunIDType; taskID?: SessionID; nodeID?: string },
  ) {
    yield* this.deps.ensureSubscribed()
    const runOpt = yield* this.deps.get(input.id)
    if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${input.id}`)
    if (runOpt.value.state === "active" || runOpt.value.state === "awaiting_approval") {
      return yield* Effect.fail(new Error(`Coordinator run cannot be retried from state: ${runOpt.value.state}`))
    }
    const taskList = yield* this.deps.relevantTasks(runOpt.value)
    const retryable = taskList
      .filter((item) => item.status === "failed" || item.status === "cancelled" || item.status === "partial")
      .filter((item) => {
        if (input.taskID) return item.task_id === input.taskID
        if (input.nodeID) return item.metadata?.coordinator_node_id === input.nodeID
        return true
      })
    if (retryable.length === 0) return yield* Effect.fail(new Error("No retryable coordinator tasks matched"))
    const tasks = this.deps.tasks
    yield* Effect.all(
      retryable.map((item) =>
        tasks.retry({
          taskID: item.task_id,
          parentSessionID: item.parent_session_id,
        }),
      ),
      {
        concurrency: BudgetTuning.concurrency.storageRead,
        discard: true,
      },
    )
    yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .update(CoordinatorRunTable)
          .set({
            state: "active",
            summary: "Coordinator run retrying",
            time_updated: this.deps.now(),
            time_finished: null,
          })
          .where(eq(CoordinatorRunTable.id, input.id))
          .run(),
      ),
    )
    const updated = yield* this.deps.runStore.readAfterUpdate(input.id)
    yield* this.deps.publishUpdated(updated)
    yield* this.deps.dispatchReady(input.id).pipe(Effect.ignore)
    const refreshed = yield* this.deps.get(input.id)
    if (Option.isNone(refreshed)) throw new Error(`Coordinator run not found: ${input.id}`)
    return refreshed.value
  })

  continueRun = Effect.fn("Coordinator.continueRun")(function* (
    this: CoordinatorRunMutations,
    input: {
      id: CoordinatorRunIDType
      budgetDelta?: Partial<ResourceLimit>
      autoContinue?: AutoContinuePolicyType
    },
  ) {
    yield* this.deps.ensureSubscribed()
    const runOpt = yield* this.deps.get(input.id)
    if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${input.id}`)
    if (runOpt.value.state !== "blocked" && runOpt.value.state !== "active") {
      return yield* Effect.fail(new Error(`Coordinator run cannot continue from state: ${runOpt.value.state}`))
    }
    const taskList = yield* this.deps.relevantTasks(runOpt.value)
    const runtime = runtimeStateFor(runOpt.value, taskList)
    const requested = input.budgetDelta ?? runtime.continuation_request?.requested_budget_delta
    const hasContinuationRequest = runtime.budget_state.budget_limited || runtime.budget_state.ceiling_hit
    if (!hasContinuationRequest) {
      return yield* Effect.fail(
        new Error("Coordinator continue denied: no active continuation request or budget checkpoint"),
      )
    }
    if (!requested) {
      return yield* Effect.fail(
        new Error("Coordinator continue requires an active continuation request or explicit budgetDelta"),
      )
    }
    const usage = resourceUsageFor(runOpt.value, taskList)
    const continuationState = runOpt.value.plan.budget_profile.continuation_state
    const consumedSinceLastApproval = resourceLimitDelta(usage, continuationState.last_approved_usage)
    const consumedEnough =
      consumedSinceLastApproval.max_rounds >= BudgetTuning.continuation.minConsumedBeforeContinue.max_rounds ||
      consumedSinceLastApproval.max_model_calls >=
        BudgetTuning.continuation.minConsumedBeforeContinue.max_model_calls ||
      consumedSinceLastApproval.max_tool_calls >= BudgetTuning.continuation.minConsumedBeforeContinue.max_tool_calls ||
      consumedSinceLastApproval.max_subagents >= BudgetTuning.continuation.minConsumedBeforeContinue.max_subagents ||
      consumedSinceLastApproval.max_wallclock_ms >=
        BudgetTuning.continuation.minConsumedBeforeContinue.max_wallclock_ms ||
      consumedSinceLastApproval.max_estimated_tokens >=
        BudgetTuning.continuation.minConsumedBeforeContinue.max_estimated_tokens
    const velocity = continuationVelocityFor({
      budgetProfile: runOpt.value.plan.budget_profile,
      todoTimeline: runtime.todo_timeline,
      progressSnapshot: runtime.progress_snapshot,
    })
    if (continuationState.approved_count > 0 && (!consumedEnough || !velocity.allowed)) {
      const deniedReason = !consumedEnough
        ? "insufficient resource consumption since the previous approved continuation"
        : velocity.reason
      yield* CoordinatorEvents.emit({
        session_id: runOpt.value.sessionID,
        run_id: runOpt.value.id,
        workflow: runOpt.value.workflow,
        effort: runOpt.value.plan.effort,
        event_kind: "continuation_decision",
        payload: {
          decision: "denied",
          reason: deniedReason,
          has_progress: velocity.allowed,
          continuation_score: velocity.continuation_score,
          consumed_enough: consumedEnough,
          usage,
          requested,
        },
      }).pipe(Effect.ignore)
      const plan = CoordinatorPlan.parse({
        ...planWithRuntimeState(runOpt.value.plan, runtime),
        budget_profile: BudgetProfile.parse({
          ...runOpt.value.plan.budget_profile,
          continuation_state: {
            ...continuationState,
            last_denied_reason: deniedReason,
          },
        }),
      })
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              summary: `Coordinator continue denied: ${deniedReason}`,
              plan,
              time_updated: this.deps.now(),
            })
            .where(eq(CoordinatorRunTable.id, input.id))
            .run(),
        ),
      )
      const updated = yield* this.deps.runStore.readAfterUpdate(input.id)
      yield* this.deps.publishUpdated(updated)
      return yield* Effect.fail(new Error(`Coordinator continue denied: ${deniedReason}`))
    }
    const delta = requested
    const fullDelta = ResourceLimit.parse({
      max_rounds: delta.max_rounds ?? 0,
      max_model_calls: delta.max_model_calls ?? 0,
      max_tool_calls: delta.max_tool_calls ?? 0,
      max_subagents: delta.max_subagents ?? 0,
      max_wallclock_ms: delta.max_wallclock_ms ?? 0,
      max_estimated_tokens: delta.max_estimated_tokens ?? 0,
    })
    const absolute_ceiling = addResourceLimit(runOpt.value.plan.budget_profile.absolute_ceiling, delta)
    const budget_profile = BudgetProfile.parse({
      ...runOpt.value.plan.budget_profile,
      auto_continue: input.autoContinue ?? runOpt.value.plan.budget_profile.auto_continue,
      mission_ceiling: capResourceLimit(
        addResourceLimit(runOpt.value.plan.budget_profile.mission_ceiling, delta),
        absolute_ceiling,
      ),
      absolute_ceiling,
      phase_ceiling: capResourceLimit(
        addResourceLimit(runOpt.value.plan.budget_profile.phase_ceiling, scaleResourceLimit(fullDelta, 0.5)),
        absolute_ceiling,
      ),
      checkpoint_reserve: capCheckpointReserve(
        addResourceLimit(runOpt.value.plan.budget_profile.checkpoint_reserve, checkpointReserveFor(fullDelta, 0.1)),
        absolute_ceiling,
      ),
      continuation_state: {
        approved_count: continuationState.approved_count + 1,
        last_approved_usage: usage,
        last_approved_progress_score: runtime.progress_snapshot.progress_score,
        last_approved_completed_todo_weight: velocity.completed_todo_weight,
        last_approved_evidence_count: velocity.evidence_count,
        last_approved_verifier_quality: runtime.progress_snapshot.verifier_quality,
        last_approved_failure_penalty: runtime.progress_snapshot.failure_penalty,
      },
    })
    yield* CoordinatorEvents.emit({
      session_id: runOpt.value.sessionID,
      run_id: runOpt.value.id,
      workflow: runOpt.value.workflow,
      effort: runOpt.value.plan.effort,
      event_kind: "continuation_decision",
      payload: {
        decision: "approved",
        reason: velocity.reason,
        has_progress: velocity.allowed,
        continuation_score: velocity.continuation_score,
        consumed_enough: true,
        usage,
        requested: fullDelta,
      },
    }).pipe(Effect.ignore)
    const plan = CoordinatorPlan.parse({
      ...planWithRuntimeState(runOpt.value.plan, runtime),
      budget_profile,
      budget_state: BudgetState.parse({}),
      continuation_request: undefined,
      budget_limited: false,
    })
    yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .update(CoordinatorRunTable)
          .set({
            state: "active",
            summary: "Coordinator run continued with approved budget",
            plan,
            time_updated: this.deps.now(),
            time_finished: null,
          })
          .where(eq(CoordinatorRunTable.id, input.id))
          .run(),
      ),
    )
    const updated = yield* this.deps.runStore.readAfterUpdate(input.id)
    yield* this.deps.publishUpdated(updated)
    yield* this.deps.dispatchReady(input.id).pipe(Effect.ignore)
    const refreshed = yield* this.deps.get(input.id)
    if (Option.isNone(refreshed)) throw new Error(`Coordinator run not found: ${input.id}`)
    return refreshed.value
  })

  resume = Effect.fn("Coordinator.resume")(function* (this: CoordinatorRunMutations, id: CoordinatorRunIDType) {
    yield* this.deps.ensureSubscribed()
    const current = yield* this.deps.get(id)
    if (Option.isNone(current)) throw new Error(`Coordinator run not found: ${id}`)
    if (current.value.state !== "blocked" && current.value.state !== "active") {
      return yield* Effect.fail(new Error(`Coordinator run cannot be resumed from state: ${current.value.state}`))
    }
    const recovered = yield* this.reconcileStaleTasks(current.value)
    const activated = yield* this.activateRun(id)
    if (activated.state !== "active") return activated
    yield* this.deps.dispatchReady(id).pipe(Effect.ignore)
    const runOpt = yield* this.deps.get(id)
    if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
    if (recovered > 0) {
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              summary: `Coordinator run resumed after recovering ${recovered} stale task${recovered === 1 ? "" : "s"}`,
              time_updated: this.deps.now(),
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      const updated = yield* this.deps.runStore.readAfterUpdate(id)
      yield* this.deps.publishUpdated(updated)
      return updated
    }
    return runOpt.value
  })
}
