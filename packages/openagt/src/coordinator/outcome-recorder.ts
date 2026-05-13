// Records optional coordinator feedback outcomes for prompt templates and calibration.
// It does not execute tasks, dispatch runs, or change coordinator state.
import { Effect, Option } from "effect"
import { TaskRuntime } from "@/session/task-runtime"
import { Calibration } from "./calibration"
import { PromptTemplates } from "./prompt-templates"
import { outcomeForVerdict, posteriorForVerdict } from "./review-verdict"
import type { CriticalReviewVerdict } from "./schema"

export class CoordinatorOutcomeRecorder {
  constructor(
    private readonly deps: {
      calibration: Option.Option<Calibration.Interface>
      promptTemplates: Option.Option<PromptTemplates.Interface>
    },
  ) {}

  recordPromptOutcome(record: TaskRuntime.TaskRecord, success: boolean): Effect.Effect<void> {
    const deps = this.deps
    return Effect.gen(function* () {
      if (Option.isNone(deps.promptTemplates)) return
      const role =
        typeof record.metadata?.prompt_template_role === "string" ? record.metadata.prompt_template_role : undefined
      const variant =
        typeof record.metadata?.prompt_template_variant === "string"
          ? record.metadata.prompt_template_variant
          : undefined
      if (!role || !variant) return
      yield* deps.promptTemplates.value
        .recordOutcome({
          role,
          variant,
          success,
          task_id: record.task_id,
          expert_id: typeof record.metadata?.expert_id === "string" ? record.metadata.expert_id : undefined,
          duration_ms:
            record.started_at && record.finished_at ? Math.max(0, record.finished_at - record.started_at) : undefined,
        })
        .pipe(Effect.ignore)
    })
  }

  recordCalibrationOutcome(
    record: TaskRuntime.TaskRecord,
    verdict: CriticalReviewVerdict | undefined,
  ): Effect.Effect<void> {
    const deps = this.deps
    return Effect.gen(function* () {
      if (!verdict || Option.isNone(deps.calibration)) return
      const expertID = typeof record.metadata?.expert_id === "string" ? record.metadata.expert_id : record.subagent_type
      const workflow = typeof record.metadata?.workflow === "string" ? record.metadata.workflow : "general-operations"
      yield* deps.calibration.value
        .record({
          expert_id: expertID,
          workflow,
          prior: 0.5,
          posterior: posteriorForVerdict(verdict),
          outcome: outcomeForVerdict(verdict),
        })
        .pipe(Effect.ignore)
    })
  }
}
