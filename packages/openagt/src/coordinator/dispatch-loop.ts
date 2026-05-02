// Owns coordinator ready-task dispatch and budget gates.
// It does not execute task prompts, create runs, or persist run summaries.
import { attachWith } from "@/effect/run-service"
import { InstanceState } from "@/effect"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { Effect, Option, Scope } from "effect"
import { BudgetTuning } from "@/agent/budget-tuning"
import { dispatchSelectionFor } from "./dispatch-selection"
import { resourceLimitSlots, resourceUsageFor, runtimeStateFor, subtractResourceLimit } from "./runtime-state"
import type { CoordinatorRun as CoordinatorRunType, CoordinatorRunID as CoordinatorRunIDType } from "./schema"

interface CoordinatorDispatchLoopInput {
  readonly tasks: TaskRuntime.Interface
  readonly scope: Scope.Scope
  readonly get: (id: CoordinatorRunIDType) => Effect.Effect<Option.Option<CoordinatorRunType>, Error>
  readonly relevantTasks: (run: CoordinatorRunType) => Effect.Effect<TaskRuntime.TaskRecord[], Error>
  readonly blockRunForBudget: (
    run: CoordinatorRunType,
    reason: "soft" | "absolute",
  ) => Effect.Effect<CoordinatorRunType, Error>
  readonly summarize: (id: CoordinatorRunIDType) => Effect.Effect<string, Error>
  readonly executeTask: (record: TaskRuntime.TaskRecord) => Effect.Effect<void, Error>
}

export class CoordinatorDispatchLoop {
  constructor(private readonly input: CoordinatorDispatchLoopInput) {}

  dispatchReady(id: CoordinatorRunIDType): Effect.Effect<{ run: CoordinatorRunType; dispatched: number }, Error> {
    const input = this.input
    return Effect.gen(function* () {
      const instance = yield* InstanceState.context
      const workspace = yield* InstanceState.workspaceID
      const runOpt = yield* input.get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const run = runOpt.value
      if (run.state !== "active") {
        return yield* Effect.fail(new Error(`Coordinator run cannot dispatch from state: ${run.state}`))
      }
      const allTasks = yield* input.relevantTasks(run)
      const pending = allTasks.filter((item) => item.status === "pending")
      // canRun receives the pre-fetched allTasks snapshot so a sweep of K
      // ready tasks is O(N) storage reads (the relevantTasks call above)
      // instead of O(K*N). See A4 in the canRun signature comment for why.
      const ready = (yield* Effect.forEach(
        pending,
        (item) =>
          input.tasks
            .canRun({
              parentSessionID: SessionID.make(run.sessionID),
              task: item,
              tasks: allTasks,
            })
            .pipe(Effect.map((allowed) => (allowed ? item : undefined))),
        {
          concurrency: BudgetTuning.concurrency.storageRead,
        },
      )).filter((item): item is TaskRuntime.TaskRecord => Boolean(item))
      const runtime = runtimeStateFor(run, allTasks)
      const checkpointReady = ready.find((item) => item.metadata?.coordinator_node_id === "budget_checkpoint_synthesis")
      const ceilingHit = runtime.budget_state.ceiling_hit
      const softBudgetHit = runtime.budget_state.soft_budget_used >= 1
      const usage = resourceUsageFor(run, allTasks)
      const normalAbsoluteLimit = subtractResourceLimit(
        run.plan.budget_profile.absolute_ceiling,
        run.plan.budget_profile.checkpoint_reserve,
      )
      const checkpointSlots = resourceLimitSlots(usage, run.plan.budget_profile.absolute_ceiling)
      if (ceilingHit || checkpointSlots === 0) {
        const blocked = yield* input.blockRunForBudget(run, "absolute")
        return {
          run: blocked,
          dispatched: 0,
        }
      }
      if (softBudgetHit && !checkpointReady) {
        const blocked = yield* input.blockRunForBudget(run, ceilingHit ? "absolute" : "soft")
        return {
          run: blocked,
          dispatched: 0,
        }
      }
      const selection = dispatchSelectionFor({
        run,
        allTasks,
        ready,
        checkpointReady,
        usage,
        normalAbsoluteLimit,
        checkpointSlots,
        ceilingHit,
        softBudgetHit,
      })
      if (selection.budgetSlots === 0 && selection.orderedReady.length > 0) {
        const blocked = yield* input.blockRunForBudget(run, "absolute")
        return {
          run: blocked,
          dispatched: 0,
        }
      }
      yield* Effect.forEach(
        selection.selected,
        (item) => attachWith(input.executeTask(item), { instance, workspace }).pipe(Effect.forkIn(input.scope)),
        {
          concurrency: BudgetTuning.concurrency.storageRead,
        },
      )
      if (selection.selected.length === 0) yield* input.summarize(id).pipe(Effect.ignore)
      return {
        run,
        dispatched: selection.selected.length,
      }
    })
  }
}
