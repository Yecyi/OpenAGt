# Mission Control

Mission Control is the CLI/TUI workflow for agentic, low-intervention work. It turns a user goal into an intent profile, coordinator plan, subagent task graph, projection, checkpoints, and reviewed result.

## CLI

Create a mission:

```sh
openagt mission "implement the requested change" --effort medium --budget normal
```

Use deeper governance for long tasks:

```sh
openagt mission "analyze this project and produce a release plan" --effort deep --budget large --watch --timeline
```

Inspect an existing run:

```sh
openagt mission --run <runID> --action projection --timeline
openagt mission --run <runID> --action checkpoint
openagt mission --run <runID> --action summarize --milestone
```

Continue or retry bounded work:

```sh
openagt mission --run <runID> --action continue --budget-delta-rounds 4
openagt mission --run <runID> --action retry --node <nodeID>
```

## Effort, Budget, and Continue

- `--effort low|medium|high|deep` controls planning rounds, verifier/reviewer depth, revise gates, MPACR usage, and timeout scaling.
- `--budget small|normal|large|max` sets mission, phase, todo, checkpoint, and absolute ceilings.
- `--auto-continue never|checkpoint|safe` controls whether budget-limited work can continue automatically.
- `continue` requires either an active continuation request or an explicit `--budget-delta-*` value.

## Long Tasks

Long tasks expose stable projection fields for CLI/TUI:

- `long_task.execution_model`
- `todo_timeline.milestones`
- `todo_timeline.current_milestone_id`
- `todo_timeline.checkpoints`
- `todo_timeline.evidence_ledger`
- `todo_timeline.memory_slices`
- `checkpoint_memory.checkpoint_type`
- `checkpoint_memory.current_milestone_id`
- `continuation_request`

The coordinator stores compact evidence and checkpoint summaries instead of passing full raw subagent transcripts through the graph.

## TUI

Open the TUI and use `/mission` to create a mission. Mission Control shows the run state, DAG, parallel groups, long-task milestones, budget usage, checkpoint history, continuation requests, quality gates, revise points, and expert lanes.

The TUI uses backend projection refresh as the source of truth. It does not maintain a separate reducer for coordinator state.

## Reasoning Visibility

Mission Control does not expose hidden chain-of-thought. User-visible depth is represented through intent, plan, effort profile, evidence, checkpoints, verifier output, reviewer verdicts, and final summaries.
