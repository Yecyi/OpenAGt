import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider"
import { Database, eq } from "@/storage"
import { Context, Effect, Layer, Option, Scope } from "effect"
import z from "zod"
import { CoordinatorRunTable } from "./coordinator.sql"
import { buildDebate, buildDegraded } from "./mpacr"
import { Calibration } from "./calibration"
import { PromptTemplates } from "./prompt-templates"
import { ThreeLayerMemory } from "@/personal/three-layer"
import { ExpertRegistry } from "./expert-registry"
import { BudgetTuning } from "@/agent/budget-tuning"
import { budgetProfileFor, longTaskProfileFor, type BudgetOptions } from "./budget-governance"
import { effortProfileFor } from "./effort-profile"
import { reviewVerdictFromText } from "./review-verdict"
import { planWithRuntimeState, runtimeStateFor } from "./runtime-state"
import { settleIntentProfile } from "./intent-profile"
import { nodeIDForTask } from "./task-record"
import { promptTemplateRoleAndVariant, promptTemplateVars } from "./task-prompt"
import { checkpointNode, node, plannerNode, reviseNode, withExpertHarness } from "./plan-node-factory"
import { parallelResearchStage, parallelVerificationStage, researcher } from "./plan-stages"
import { expandVerifyNodes, orderPlan, planValidationErrorMessage, validatePlanResult } from "./plan-ordering"
import { workspaceSignalsForGoal, type WorkspaceSignals } from "./workspace-signals"
import { buildCoordinatorProjection, type CoordinatorProjection } from "./projection"
import { buildCoordinatorSummary } from "./summary"
import { CoordinatorTaskSessionFactory } from "./task-session-factory"
import { CoordinatorDispatchLoop } from "./dispatch-loop"
import { CoordinatorTaskExecutor } from "./task-executor"
import { CoordinatorRunFactory } from "./run-factory"
import { CoordinatorOutcomeRecorder } from "./outcome-recorder"
import { CoordinatorRunStore } from "./run-store"
import { CoordinatorRunMutations } from "./run-mutations"
import { CoordinatorSubscriptionManager } from "./subscription-manager"
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
  ProgressSnapshot,
  CheckpointMemorySummary,
  ContinuationRequest,
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
    const outcomeRecorder = new CoordinatorOutcomeRecorder({ calibration, promptTemplates })
    const runStore = new CoordinatorRunStore()

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
      // B1: structured validation — surface duplicate/missing-dep/cycle with
      // typed detail instead of an untagged thrown Error. Auto-repair is
      // deliberately NOT applied here: existing tests assert that the
      // coordinator REJECTS user-provided plans with dangling deps, because
      // silently dropping them masks planner bugs at the source. Callers
      // wanting auto-repair can call repairMissingDeps explicitly.
      const validation = validatePlanResult(governed)
      if (!validation.ok) {
        return yield* Effect.fail(new Error(planValidationErrorMessage(validation)))
      }
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
        .pickVariant(
          { ...roleAndVariant, seed: `${runID}:${node.id}`, expertID: node.expert_id },
          promptTemplateVars(node),
          () => node.prompt,
        )
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
      const updated = yield* runStore.readAfterUpdate(run.id)
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
          : `Coordinator budget checkpoint reached (${runtime.budget_state.limit_reason}); checkpoint or continuation is required`
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
      const updated = yield* runStore.readAfterUpdate(run.id)
      yield* publish(Event.Updated, updated)
      return updated
    })

    const blockRunForDispatchFailure = Effect.fn("Coordinator.blockRunForDispatchFailure")(function* (
      id: CoordinatorRunIDType,
      reason: string,
    ) {
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt) || runOpt.value.state !== "active") return
      const taskList = yield* relevantTasks(runOpt.value)
      const runtime = runtimeStateFor(runOpt.value, taskList)
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "blocked",
              summary: `Coordinator dispatch failed after task update: ${reason.slice(0, 240)}`,
              plan: planWithRuntimeState(runOpt.value.plan, runtime),
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      const updated = yield* runStore.readAfterUpdate(id)
      yield* publish(Event.Updated, updated)
    })

    const taskExecutor = new CoordinatorTaskExecutor({
      tasks,
      getPrompt: () => Effect.serviceOption(SessionPrompt.Service),
      get: (id) => get(id),
      persistRuntimeState,
      dispatchReady: (id) => dispatchReady(id),
      recordPromptOutcome: (record, success) => outcomeRecorder.recordPromptOutcome(record, success),
      recordCalibrationOutcome: (record, verdict) => outcomeRecorder.recordCalibrationOutcome(record, verdict),
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

    const subscriptionManager = new CoordinatorSubscriptionManager(bus, dispatchReady, blockRunForDispatchFailure)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        subscriptionManager.clear()
      }),
    )

    const ensureSubscribed: () => Effect.Effect<void, Error> = () => subscriptionManager.ensureSubscribed()

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
      const parent = yield* sessions.get(input.sessionID)
      const created = yield* runFactory.create({
        runID,
        sessionID: input.sessionID,
        projectID: parent.projectID,
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
      return yield* runStore.get(id)
    })

    const list: Interface["list"] = Effect.fn("Coordinator.list")(function* (sessionID) {
      yield* ensureSubscribed()
      return yield* runStore.list(sessionID)
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
      const updated = yield* runStore.readAfterUpdate(id)
      yield* publish(state === "completed" ? Event.Completed : Event.Updated, updated)
      return summary
    })

    const runMutations = new CoordinatorRunMutations({
      tasks,
      runStore,
      now,
      ensureSubscribed,
      get,
      relevantTasks,
      dispatchReady: (id) => dispatchReady(id).pipe(Effect.asVoid),
      publishUpdated: (run) => publish(Event.Updated, run).pipe(Effect.asVoid),
    })
    const approve: Interface["approve"] = (id) => runMutations.approve(id)
    const cancel: Interface["cancel"] = (id) => runMutations.cancel(id)
    const retry: Interface["retry"] = (input) => runMutations.retry(input)
    const continueRun: Interface["continueRun"] = (input) => runMutations.continueRun(input)
    const resume: Interface["resume"] = (id) => runMutations.resume(id)

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
