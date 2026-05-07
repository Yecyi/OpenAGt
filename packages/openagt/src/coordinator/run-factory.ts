// Owns coordinator run row and task record creation.
// It does not decide approval state, dispatch tasks, or publish coordinator events.
import type { SessionID } from "@/session/schema"
import type { ProjectID } from "@/project/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { Database, eq } from "@/storage"
import { Effect } from "effect"
import { CoordinatorRunTable } from "./coordinator.sql"
import { reviewMemoryPatternsForNode } from "./expert-memory-context"
import { runFromRow } from "./run-row"
import { CoordinatorTaskSessionFactory } from "./task-session-factory"
import type {
  CoordinatorMode as CoordinatorModeType,
  CoordinatorNode as CoordinatorNodeType,
  CoordinatorPlan as CoordinatorPlanType,
  CoordinatorRun as CoordinatorRunType,
  CoordinatorRunID as CoordinatorRunIDType,
  CoordinatorRunState as CoordinatorRunStateType,
  IntentProfile as IntentProfileType,
} from "./schema"

interface PromptTemplateSelection {
  readonly prompt: string
  readonly prompt_template_role?: string
  readonly prompt_template_variant?: string
}

interface CoordinatorRunFactoryInput {
  readonly tasks: TaskRuntime.Interface
  readonly taskSessionFactory: CoordinatorTaskSessionFactory
  readonly now: () => number
  readonly promptTemplateSelection: (
    runID: CoordinatorRunIDType,
    node: CoordinatorNodeType,
  ) => Effect.Effect<PromptTemplateSelection>
}

export class CoordinatorRunFactory {
  constructor(private readonly input: CoordinatorRunFactoryInput) {}

  create(params: {
    runID: CoordinatorRunIDType
    sessionID: SessionID
    projectID?: ProjectID
    goal: string
    intent: IntentProfileType
    mode: CoordinatorModeType
    state: CoordinatorRunStateType
    planned: CoordinatorPlanType
  }): Effect.Effect<CoordinatorRunType, Error> {
    const deps = this.input
    return Effect.gen(function* () {
      const nodeTaskIDs = new Map<string, SessionID>()
      for (const node of params.planned.nodes) {
        const session = yield* deps.taskSessionFactory.create({ sessionID: params.sessionID, node })
        nodeTaskIDs.set(node.id, session.id)
      }
      for (const node of params.planned.nodes) {
        const taskID = nodeTaskIDs.get(node.id)
        if (!taskID) continue
        const selectedPrompt = yield* deps.promptTemplateSelection(params.runID, node)
        const reviewMemoryPatterns = yield* Effect.sync(() =>
          reviewMemoryPatternsForNode({
            projectID: params.projectID,
            node,
            workflow: node.workflow ?? params.planned.workflow,
          }),
        ).pipe(Effect.catch(() => Effect.succeed([])))
        yield* deps.tasks.create({
          parentSessionID: params.sessionID,
          childSessionID: taskID,
          groupID: params.runID,
          strategy: "mixed",
          taskKind: node.task_kind,
          subagentType: node.subagent_type,
          description: node.description,
          prompt: selectedPrompt.prompt,
          dependsOn: node.depends_on.flatMap((item) => {
            const dependency = nodeTaskIDs.get(item)
            return dependency ? [dependency] : []
          }),
          metadata: {
            prompt: selectedPrompt.prompt,
            prompt_template_id: node.prompt_template_id,
            prompt_template_role: selectedPrompt.prompt_template_role,
            prompt_template_variant: selectedPrompt.prompt_template_variant,
            write_scope: node.write_scope,
            read_scope: node.read_scope,
            acceptance_checks: node.acceptance_checks,
            priority: node.priority,
            origin: node.origin,
            coordinator_node_id: node.id,
            coordinator_run_id: params.runID,
            role: node.role,
            model: node.model,
            risk: node.risk,
            parallel_group: node.parallel_group,
            assigned_scope: node.assigned_scope,
            excluded_scope: node.excluded_scope,
            merge_status: node.merge_status,
            conflicts: node.conflicts,
            output_schema: node.output_schema,
            requires_user_input: node.requires_user_input,
            effort: params.planned.effort,
            effort_profile: params.planned.effort_profile,
            long_task: params.planned.long_task,
            todo_timeline: params.planned.todo_timeline,
            budget_profile: params.planned.budget_profile,
            expert_id: node.expert_id,
            expert_role: node.expert_role,
            workflow: node.workflow ?? params.planned.workflow,
            artifact_type: node.artifact_type,
            artifact_id: node.artifact_id,
            revision_of: node.revision_of,
            quality_gate_id: node.quality_gate_id,
            mpacr_role: node.mpacr_role,
            mpacr_perspective: node.mpacr_perspective,
            mpacr_quorum: node.mpacr_quorum,
            mpacr_critic_node_ids: node.mpacr_critic_node_ids,
            mpacr_per_critic_timeout_ms: node.mpacr_per_critic_timeout_ms,
            mpacr_degraded: node.mpacr_degraded,
            memory_namespace: node.memory_namespace,
            review_memory_patterns: reviewMemoryPatterns,
            confidence: node.confidence,
            revise_policy: node.revise_policy,
            intent: params.intent,
            mode: params.mode,
          },
          writeScope: node.write_scope,
          readScope: node.read_scope,
          acceptanceChecks: node.acceptance_checks,
          priority: node.priority,
          origin: node.origin,
        })
      }
      const timestamp = deps.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(CoordinatorRunTable)
            .values({
              id: params.runID,
              session_id: params.sessionID,
              goal: params.goal,
              intent: params.intent,
              mode: params.mode,
              workflow: params.intent.workflow,
              state: params.state,
              plan: params.planned,
              task_ids: [...nodeTaskIDs.values()],
              time_created: timestamp,
              time_updated: timestamp,
            })
            .run(),
        ),
      )
      return yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, params.runID)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
    })
  }
}
