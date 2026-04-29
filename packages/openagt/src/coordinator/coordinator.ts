import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider"
import { Database, desc, eq } from "@/storage"
import { Context, Effect, Layer, Option, Scope } from "effect"
import z from "zod"
import { CoordinatorRunTable } from "./coordinator.sql"
import { buildDebate, buildDegraded } from "./mpacr"
import { Calibration } from "./calibration"
import { PromptTemplates } from "./prompt-templates"
import { ThreeLayerMemory } from "@/personal/three-layer"
import { ExpertRegistry } from "./expert-registry"
import { BudgetTuning } from "@/agent/budget-tuning"
import {
  addResourceLimit,
  budgetProfileFor,
  longTaskProfileFor,
  scaleResourceLimit,
  type BudgetOptions,
} from "./budget-governance"
import { effortProfileFor } from "./effort-profile"
import {
  outcomeForVerdict,
  posteriorForVerdict,
  reviewVerdictFromText,
} from "./review-verdict"
import {
  planWithRuntimeState,
  runtimeStateFor,
} from "./runtime-state"
import { settleIntentProfile } from "./intent-profile"
import { nodeIDForTask } from "./task-record"
import { promptTemplateRoleAndVariant, promptTemplateVars } from "./task-prompt"
import { checkpointNode, node, plannerNode, reviseNode, withExpertHarness } from "./plan-node-factory"
import { parallelResearchStage, parallelVerificationStage, researcher } from "./plan-stages"
import { expandVerifyNodes, orderPlan, validatePlan } from "./plan-ordering"
import { workspaceSignalsForGoal, type WorkspaceSignals } from "./workspace-signals"
import { buildCoordinatorProjection, type CoordinatorProjection } from "./projection"
import { buildCoordinatorSummary } from "./summary"
import { runFromRow } from "./run-row"
import { CoordinatorTaskSessionFactory } from "./task-session-factory"
import { CoordinatorDispatchLoop } from "./dispatch-loop"
import { CoordinatorTaskExecutor } from "./task-executor"
import { CoordinatorRunFactory } from "./run-factory"
import {
  CoordinatorNode,
  CoordinatorPlan,
  CoordinatorRun,
  CoordinatorRunID,
  EffortLevel,
  EffortProfile,
  ExpertLane,
  QualityGate,
  ParallelExecutionPolicy,
  RevisePoint,
  IntentProfile,
  TodoTimeline,
  BudgetProfile,
  BudgetState,
  ProgressSnapshot,
  CheckpointMemorySummary,
  ContinuationRequest,
  ResourceLimit,
  type CoordinatorNode as CoordinatorNodeType,
  type CoordinatorNodeInput,
  type AutoContinuePolicy as AutoContinuePolicyType,
  type BudgetProfile as BudgetProfileType,
  type CheckpointMemorySummary as CheckpointMemorySummaryType,
  type EffortLevel as EffortLevelType,
  type EffortProfile as EffortProfileType,
  type LongTaskProfile as LongTaskProfileType,
  type ProgressSnapshot as ProgressSnapshotType,
  type CoordinatorMode as CoordinatorModeType,
  type CoordinatorPlan as CoordinatorPlanType,
  type CoordinatorRun as CoordinatorRunType,
  type CoordinatorRunID as CoordinatorRunIDType,
  type CriticalReviewVerdict as CriticalReviewVerdictType,
  type IntentProfile as IntentProfileType,
  type ParallelExecutionPolicy as ParallelExecutionPolicyType,
  type ResourceLimit as ResourceLimitType,
  type TaskType as TaskTypeType,
  type TodoTimeline as TodoTimelineType,
} from "./schema"

export { effortProfileFor } from "./effort-profile"
export { settleIntentProfile } from "./intent-profile"
export { shouldUseDegradedMpacr } from "./graph-revisions"
export { basePlanForIntent } from "./base-plan"
export { applyEffortGovernance, defaultPlanForIntent } from "./effort-governance"

import { basePlanForIntent } from "./base-plan"
import { applyEffortGovernance } from "./effort-governance"

function now() {
  return Date.now()
}

export const Event = {
  Created: BusEvent.define("coordinator.created", CoordinatorRun),
  Updated: BusEvent.define("coordinator.updated", CoordinatorRun),
  Completed: BusEvent.define("coordinator.completed", CoordinatorRun),
}

export interface Interface {
  readonly settleIntent: (input: { goal: string }) => Effect.Effect<IntentProfileType, Error>
  readonly plan: (
    input: {
      goal: string
      nodes?: CoordinatorNodeInput[]
      intent?: IntentProfileType
      effort?: EffortLevelType
      workflow?: TaskTypeType
      parallel_policy?: Partial<ParallelExecutionPolicyType>
    } & BudgetOptions,
  ) => Effect.Effect<CoordinatorPlanType, Error>
  readonly run: (
    input: {
      sessionID: SessionID
      goal: string
      nodes?: CoordinatorNodeInput[]
      intent?: IntentProfileType
      effort?: EffortLevelType
      workflow?: TaskTypeType
      mode?: CoordinatorModeType
      approved?: boolean
      parallel_policy?: Partial<ParallelExecutionPolicyType>
    } & BudgetOptions,
  ) => Effect.Effect<CoordinatorRunType, Error>
  readonly approve: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly cancel: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly retry: (input: {
    id: CoordinatorRunIDType
    taskID?: SessionID
    nodeID?: string
  }) => Effect.Effect<CoordinatorRunType, Error>
  readonly continueRun: (input: {
    id: CoordinatorRunIDType
    budgetDelta?: Partial<ResourceLimitType>
    autoContinue?: AutoContinuePolicyType
  }) => Effect.Effect<CoordinatorRunType, Error>
  readonly get: (id: CoordinatorRunIDType) => Effect.Effect<Option.Option<CoordinatorRunType>, Error>
  readonly list: (sessionID: SessionID) => Effect.Effect<CoordinatorRunType[], Error>
  readonly dispatch: (id: CoordinatorRunIDType) => Effect.Effect<{ run: CoordinatorRunType; dispatched: number }, Error>
  readonly projection: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorProjection, Error>
  readonly resume: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly summarize: (id: CoordinatorRunIDType) => Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/Coordinator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service
    const tasks = yield* TaskRuntime.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const tlm = yield* ThreeLayerMemory.Service
    const expertRegistry = yield* ExpertRegistry.Service
    const calibration = yield* Effect.serviceOption(Calibration.Service)
    const promptTemplates = yield* Effect.serviceOption(PromptTemplates.Service)
    const scope = yield* Scope.Scope
    const taskSessionFactory = new CoordinatorTaskSessionFactory(agents, sessions)

    const publish = (
      def: typeof Event.Created | typeof Event.Updated | typeof Event.Completed,
      run: CoordinatorRunType,
    ) => bus.publish(def, run)

    const settleIntent: Interface["settleIntent"] = Effect.fn("Coordinator.settleIntent")(function* (input) {
      return settleIntentProfile(input)
    })

    const plan: Interface["plan"] = Effect.fn("Coordinator.plan")(function* (input) {
      const settled = input.intent ?? settleIntentProfile({ goal: input.goal })
      const workflow = input.workflow ?? settled.workflow
      const effort = input.effort ?? "medium"
      const intent = IntentProfile.parse({
        ...settled,
        workflow,
        task_type: workflow,
      })
      const parallel_policy = ParallelExecutionPolicy.parse(input.parallel_policy ?? {})
      const base =
        input.nodes && input.nodes.length > 0
          ? CoordinatorPlan.parse({
              goal: input.goal,
              nodes: input.nodes,
              parallel_policy,
              effort,
              workflow,
              effort_profile: effortProfileFor(effort),
            })
          : CoordinatorPlan.parse({ ...basePlanForIntent(intent), parallel_policy })
      const expanded = expandVerifyNodes(base)
      const governed = applyEffortGovernance(expanded, intent, effort, input)
      yield* Effect.try({
        try: () => validatePlan(governed),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      yield* Effect.forEach(
        governed.nodes.flatMap((item) => (item.model ? [item.model] : [])),
        (model) => provider.getModel(ProviderID.make(model.providerID), ModelID.make(model.modelID)),
        { concurrency: BudgetTuning.concurrency.storageRead, discard: true },
      )
      const ordered = orderPlan(governed)
      // B.4 — enrich memory_context with semantic facts + procedural recipes
      // from prior sessions. Best-effort: failures degrade to the bare plan
      // so a memory backend hiccup never blocks plan creation. Provide tlm
      // explicitly so this Effect's R type stays `never` (matches Interface.plan).
      const enriched = yield* ThreeLayerMemory.enrichPlanMemory(ordered).pipe(
        Effect.provideService(ThreeLayerMemory.Service, tlm),
        Effect.catch(() => Effect.succeed(ordered)),
      )
      // C.4 — apply user-defined expert overrides. Each plan node whose role
      // matches a registered user expert's `inherits` gets prompt + expert_id
      // + memory_namespace replaced. Same best-effort posture: registry hiccup
      // never blocks plan creation.
      const finalPlan = yield* ExpertRegistry.applyUserExpertsToPlan(enriched).pipe(
        Effect.provideService(ExpertRegistry.Service, expertRegistry),
        Effect.catch(() => Effect.succeed(enriched)),
      )
      return finalPlan
    })

    const promptTemplateSelection = Effect.fn("Coordinator.promptTemplateSelection")(function* (
      runID: CoordinatorRunIDType,
      node: CoordinatorNodeType,
    ) {
      if (Option.isNone(promptTemplates)) return { prompt: node.prompt }
      const roleAndVariant = promptTemplateRoleAndVariant(node)
      const picked = yield* promptTemplates.value
        .pickVariant({ ...roleAndVariant, seed: `${runID}:${node.id}` }, promptTemplateVars(node), () => node.prompt)
        .pipe(Effect.catch(() => Effect.succeed({ template: undefined, rendered: node.prompt })))
      return {
        prompt: picked.rendered || node.prompt,
        prompt_template_role: picked.template?.role,
        prompt_template_variant: picked.template?.variant,
      }
    })

    const runFactory = new CoordinatorRunFactory({
      tasks,
      taskSessionFactory,
      now,
      promptTemplateSelection,
    })

    const recordPromptOutcome = (record: TaskRuntime.TaskRecord, success: boolean) => {
      if (Option.isNone(promptTemplates)) return Effect.void
      const role =
        typeof record.metadata?.prompt_template_role === "string" ? record.metadata.prompt_template_role : undefined
      const variant =
        typeof record.metadata?.prompt_template_variant === "string"
          ? record.metadata.prompt_template_variant
          : undefined
      if (!role || !variant) return Effect.void
      return promptTemplates.value.recordOutcome({
        role,
        variant,
        success,
        task_id: record.task_id,
        expert_id: typeof record.metadata?.expert_id === "string" ? record.metadata.expert_id : undefined,
        duration_ms:
          record.started_at && record.finished_at ? Math.max(0, record.finished_at - record.started_at) : undefined,
      }).pipe(Effect.ignore)
    }

    const recordCalibrationOutcome = (record: TaskRuntime.TaskRecord, verdict: CriticalReviewVerdictType | undefined) => {
      if (!verdict || Option.isNone(calibration)) return Effect.void
      const expertID = typeof record.metadata?.expert_id === "string" ? record.metadata.expert_id : record.subagent_type
      const workflow = typeof record.metadata?.workflow === "string" ? record.metadata.workflow : "general-operations"
      return calibration.value
        .record({
          expert_id: expertID,
          workflow,
          prior: 0.5,
          posterior: posteriorForVerdict(verdict),
          outcome: outcomeForVerdict(verdict),
        })
        .pipe(Effect.ignore)
    }

    const relevantTasks = Effect.fn("Coordinator.relevantTasks")(function* (run: CoordinatorRunType) {
      const all = yield* tasks.list(SessionID.make(run.sessionID))
      const taskIDs = new Set(run.task_ids.map((item) => SessionID.make(item)))
      return all.filter((item) => taskIDs.has(item.task_id))
    })

    const persistRuntimeState = Effect.fn("Coordinator.persistRuntimeState")(function* (run: CoordinatorRunType) {
      const taskList = yield* relevantTasks(run)
      const runtime = runtimeStateFor(run, taskList)
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              plan: planWithRuntimeState(run.plan, runtime),
              time_updated: now(),
            })
            .where(eq(CoordinatorRunTable.id, run.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, run.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const blockRunForBudget = Effect.fn("Coordinator.blockRunForBudget")(function* (
      run: CoordinatorRunType,
      reason: "soft" | "absolute",
    ) {
      const taskList = yield* relevantTasks(run)
      const runtime = runtimeStateFor(run, taskList)
      const summary =
        reason === "absolute"
          ? "Coordinator budget absolute ceiling reached; continuation requires user approval"
          : "Coordinator mission budget reached; checkpoint or continuation is required"
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "blocked",
              summary,
              plan: planWithRuntimeState(run.plan, runtime),
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, run.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, run.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const taskExecutor = new CoordinatorTaskExecutor({
      tasks,
      getPrompt: () => Effect.serviceOption(SessionPrompt.Service),
      get: (id) => get(id),
      persistRuntimeState,
      dispatchReady: (id) => dispatchReady(id),
      recordPromptOutcome,
      recordCalibrationOutcome,
    })
    const executeTask: (record: TaskRuntime.TaskRecord) => Effect.Effect<void, Error> = Effect.fn(
      "Coordinator.executeTask",
    )((record) => taskExecutor.execute(record))

    const dispatchLoop = new CoordinatorDispatchLoop({
      tasks,
      scope,
      get: (id) => get(id),
      relevantTasks,
      blockRunForBudget,
      summarize: (id) => summarize(id),
      executeTask,
    })
    const dispatchReady: Interface["dispatch"] = Effect.fn("Coordinator.dispatchReady")((id) =>
      dispatchLoop.dispatchReady(id),
    )

    const subscriptionStops = new Map<string, () => void>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const stop of subscriptionStops.values()) stop()
        subscriptionStops.clear()
      }),
    )

    const ensureSubscribed: () => Effect.Effect<void, Error> = Effect.fn("Coordinator.ensureSubscribed")(function* () {
      const instance = yield* InstanceState.context
      if (subscriptionStops.has(instance.directory)) return
      const workspace = yield* InstanceState.workspaceID
      const stopTaskSubscription = yield* bus.subscribeCallback(TaskRuntime.Event.Updated, (event) => {
        if (!event.properties.result.group_id) return
        const runID = event.properties.result.group_id as CoordinatorRunIDType
        void Effect.runPromise(
          attachWith(dispatchReady(runID), {
            instance,
            workspace,
          }).pipe(Effect.catchCause(() => Effect.void)),
        )
      })
      subscriptionStops.set(instance.directory, () => {
        stopTaskSubscription()
        subscriptionStops.delete(instance.directory)
      })
    })

    const run: Interface["run"] = Effect.fn("Coordinator.run")(function* (input) {
      yield* ensureSubscribed()
      const settled = input.intent ?? settleIntentProfile({ goal: input.goal })
      const workflow = input.workflow ?? settled.workflow
      const intent = IntentProfile.parse({
        ...settled,
        workflow,
        task_type: workflow,
      })
      const planned = yield* plan({
        goal: input.goal,
        nodes: input.nodes,
        intent,
        effort: input.effort,
        workflow,
        parallel_policy: input.parallel_policy,
        budget: input.budget,
        autoContinue: input.autoContinue,
        maxRounds: input.maxRounds,
        maxSubagents: input.maxSubagents,
        maxWallclockMs: input.maxWallclockMs,
      })
      const mode = input.mode ?? (intent.risk_level === "high" ? "assisted" : "autonomous")
      const state =
        input.approved || (mode === "autonomous" && !intent.needs_user_clarification && intent.risk_level !== "high")
          ? "active"
          : "awaiting_approval"
      const runID = CoordinatorRunID.ascending()
      const created = yield* runFactory.create({
        runID,
        sessionID: input.sessionID,
        goal: input.goal,
        intent,
        mode,
        state,
        planned,
      })
      yield* publish(Event.Created, created)
      if (created.state === "active") yield* dispatchReady(created.id)
      return created
    })

    const get: Interface["get"] = Effect.fn("Coordinator.get")(function* (id) {
      yield* ensureSubscribed()
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      )
      return row ? Option.some(runFromRow(row)) : Option.none()
    })

    const list: Interface["list"] = Effect.fn("Coordinator.list")(function* (sessionID) {
      yield* ensureSubscribed()
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(CoordinatorRunTable)
            .where(eq(CoordinatorRunTable.session_id, sessionID))
            .orderBy(desc(CoordinatorRunTable.time_created))
            .all(),
        ),
      )
      return rows.map(runFromRow)
    })

    const projection: Interface["projection"] = Effect.fn("Coordinator.projection")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const run = runOpt.value
      const taskList = yield* relevantTasks(run)
      const runtime = runtimeStateFor(run, taskList)
      return buildCoordinatorProjection({ run, taskList, runtime })
    })

    const summarize: Interface["summarize"] = Effect.fn("Coordinator.summarize")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const info = runOpt.value
      if (info.state === "cancelled") return info.summary ?? "Run cancelled"
      const taskIDs = info.task_ids.map((item) => SessionID.make(item))
      const all = yield* tasks.list(SessionID.make(info.sessionID))
      const relevant = all.filter((item: (typeof all)[number]) => taskIDs.includes(item.task_id))
      const { summary, state } = buildCoordinatorSummary(relevant)
      const runtime = runtimeStateFor(info, relevant)
      const finished = state === "completed" || state === "failed" || state === "cancelled" ? now() : null
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state,
              summary,
              plan: planWithRuntimeState(info.plan, runtime),
              time_updated: now(),
              time_finished: finished,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(state === "completed" ? Event.Completed : Event.Updated, updated)
      return summary
    })

    const activateRun = Effect.fn("Coordinator.activateRun")(function* (id: CoordinatorRunIDType) {
      const runOpt = yield* get(id)
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
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const approve: Interface["approve"] = Effect.fn("Coordinator.approve")(function* (id) {
      yield* ensureSubscribed()
      const current = yield* get(id)
      if (Option.isNone(current)) throw new Error(`Coordinator run not found: ${id}`)
      if (current.value.state !== "awaiting_approval" && current.value.state !== "planned") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be approved from state: ${current.value.state}`))
      }
      const activated = yield* activateRun(id)
      if (activated.state === "active") yield* dispatchReady(id)
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      return runOpt.value
    })

    const cancel: Interface["cancel"] = Effect.fn("Coordinator.cancel")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      if (runOpt.value.state === "completed" || runOpt.value.state === "failed" || runOpt.value.state === "cancelled") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be cancelled from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const prompt = yield* Effect.serviceOption(SessionPrompt.Service)
      const timestamp = now()
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
      yield* Effect.forEach(
        taskList.filter((item) => item.status === "pending" || item.status === "running"),
        (item) =>
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
        {
          concurrency: BudgetTuning.concurrency.storageRead,
        },
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const retry: Interface["retry"] = Effect.fn("Coordinator.retry")(function* (input) {
      yield* ensureSubscribed()
      const runOpt = yield* get(input.id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${input.id}`)
      if (runOpt.value.state === "active" || runOpt.value.state === "awaiting_approval") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be retried from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const retryable = taskList
        .filter((item) => item.status === "failed" || item.status === "cancelled" || item.status === "partial")
        .filter((item) => {
          if (input.taskID) return item.task_id === input.taskID
          if (input.nodeID) return item.metadata?.coordinator_node_id === input.nodeID
          return true
        })
      if (retryable.length === 0) return yield* Effect.fail(new Error("No retryable coordinator tasks matched"))
      yield* Effect.forEach(
        retryable,
        (item) =>
          tasks.retry({
            taskID: item.task_id,
            parentSessionID: item.parent_session_id,
          }),
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
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, input.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, input.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      yield* dispatchReady(input.id).pipe(Effect.ignore)
      const refreshed = yield* get(input.id)
      if (Option.isNone(refreshed)) throw new Error(`Coordinator run not found: ${input.id}`)
      return refreshed.value
    })

    const continueRun: Interface["continueRun"] = Effect.fn("Coordinator.continueRun")(function* (input) {
      yield* ensureSubscribed()
      const runOpt = yield* get(input.id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${input.id}`)
      if (runOpt.value.state !== "blocked" && runOpt.value.state !== "active") {
        return yield* Effect.fail(new Error(`Coordinator run cannot continue from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const runtime = runtimeStateFor(runOpt.value, taskList)
      const requested = input.budgetDelta ?? runtime.continuation_request?.requested_budget_delta
      if (!requested) {
        return yield* Effect.fail(
          new Error("Coordinator continue requires an active continuation request or explicit budgetDelta"),
        )
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
      const budget_profile = BudgetProfile.parse({
        ...runOpt.value.plan.budget_profile,
        auto_continue: input.autoContinue ?? runOpt.value.plan.budget_profile.auto_continue,
        mission_ceiling: addResourceLimit(runOpt.value.plan.budget_profile.mission_ceiling, delta),
        absolute_ceiling: addResourceLimit(runOpt.value.plan.budget_profile.absolute_ceiling, delta),
        phase_ceiling: addResourceLimit(
          runOpt.value.plan.budget_profile.phase_ceiling,
          scaleResourceLimit(fullDelta, 0.5),
        ),
        checkpoint_reserve: addResourceLimit(
          runOpt.value.plan.budget_profile.checkpoint_reserve,
          scaleResourceLimit(fullDelta, 0.1),
        ),
      })
      const plan = CoordinatorPlan.parse({
        ...planWithRuntimeState(runOpt.value.plan, runtime),
        budget_profile,
        budget_state: BudgetState.parse({}),
        continuation_request: undefined,
      })
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "active",
              summary: "Coordinator run continued with approved budget",
              plan,
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, input.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, input.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      yield* dispatchReady(input.id).pipe(Effect.ignore)
      const refreshed = yield* get(input.id)
      if (Option.isNone(refreshed)) throw new Error(`Coordinator run not found: ${input.id}`)
      return refreshed.value
    })

    const resume: Interface["resume"] = Effect.fn("Coordinator.resume")(function* (id) {
      yield* ensureSubscribed()
      const current = yield* get(id)
      if (Option.isNone(current)) throw new Error(`Coordinator run not found: ${id}`)
      if (current.value.state !== "blocked" && current.value.state !== "active") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be resumed from state: ${current.value.state}`))
      }
      const activated = yield* activateRun(id)
      if (activated.state !== "active") return activated
      yield* dispatchReady(id).pipe(Effect.ignore)
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      return runOpt.value
    })

    return Service.of({
      settleIntent,
      plan,
      run,
      approve,
      cancel,
      retry,
      continueRun,
      get,
      list,
      dispatch: dispatchReady,
      projection,
      resume,
      summarize,
    })
  }),
)

// ThreeLayerMemory and ExpertRegistry are NOT bundled here (they would create
// a circular import via personal.ts → coordinator.ts). AppRuntime's mergeAll
// composes them at the peer level so the Coordinator's runtime Service
// requirements are satisfied at the merged layer.
export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(TaskRuntime.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Provider.defaultLayer),
)

export * as Coordinator from "./coordinator"
