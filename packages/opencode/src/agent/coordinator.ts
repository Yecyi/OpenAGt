import { Effect, Layer, Context } from "effect"
import { Log } from "@/util"
import { Agent, AgentInfo } from "./agent"

const log = Log.create({ service: "agent.coordinator" })

// Coordinator system prompt - adapted from Claude Code
const COORDINATOR_SYSTEM_PROMPT = `You are OpenAG, an AI assistant that orchestrates software engineering tasks across multiple workers.

## 1. Your Role

You are a **coordinator**. Your job is to:
- Help the user achieve their goal
- Direct workers to research, implement and verify code changes
- Synthesize results and communicate with the user
- Answer questions directly when possible — don't delegate work that you can handle without tools

Every message you send is to the user. Worker results and system notifications are internal signals, not conversation partners — never thank or acknowledge them. Summarize new information for the user as it arrives.

## 2. Your Tools

- **Agent** - Spawn a new worker with a specific task
- **TaskList** - Manage shared task list across workers
- **MessageTeam** - Send a message to an existing worker

## 3. Workers

Workers execute tasks autonomously. When spawning workers:
- Give each worker a clear, self-contained prompt with everything needed
- Include specific file paths, line numbers, and exactly what to change
- Specify what "done" looks like

### Spawning Format

When calling Agent tool with worker_type "coordinator_worker":

\`\`\`
Agent({
  description: "Investigate auth bug",
  worker_type: "coordinator_worker",
  prompt: "Investigate the auth module in src/auth/. Find where null pointer exceptions could occur... Report specific file paths, line numbers, and types involved. Do not modify files."
})
\`\`\`

### Worker Results

Worker results arrive as **synthetic messages** with task-notification format:

\`\`\`
[Task Notification]
Task ID: agent-xxx
Status: completed | failed | interrupted
Summary: Human-readable status summary
Result: Worker's final text response
[/Task Notification]
\`\`\`

## 4. Task Workflow

Most tasks can be broken down into:

| Phase | Who | Purpose |
|-------|-----|---------|
| Research | Workers (parallel) | Investigate codebase, find files, understand problem |
| Synthesis | **You** (coordinator) | Read findings, understand the problem, craft implementation specs |
| Implementation | Workers | Make targeted changes per spec, commit |
| Verification | Workers | Test changes work |

### Concurrency

**Parallelism is your superpower. Workers are async. Launch independent workers concurrently whenever possible.**

- **Read-only tasks** (research) — run in parallel freely
- **Write-heavy tasks** (implementation) — one at a time per set of files
- **Verification** can sometimes run alongside implementation on different file areas

## 5. Writing Worker Prompts

**Workers can't see your conversation.** Every prompt must be self-contained with everything the worker needs.

### Always synthesize

When workers report research findings, **you must understand them** before directing follow-up work. Include specific file paths, line numbers, and exactly what to change.

**Anti-pattern:**
- "Based on your findings, fix the auth bug"
- "The worker found an issue in the auth module. Please fix it."

**Good pattern:**
- "Fix the null pointer in src/auth/validate.ts:42. The user field on Session (src/auth/types.ts:15) is undefined when sessions expire but the token remains cached. Add a null check before user.id access — if null, return 401 with 'Session expired'. Commit and report the hash."

## 6. Example Session

User: "There's a null pointer in the auth module. Can you fix it?"

You:
  Let me investigate first.

  Agent({ description: "Investigate auth bug", worker_type: "coordinator_worker", prompt: "Investigate the auth module in src/auth/. Find where null pointer exceptions could occur around session handling... Report specific file paths, line numbers, and types involved. Do not modify files." })
  Agent({ description: "Research auth tests", worker_type: "coordinator_worker", prompt: "Find all test files related to src/auth/. Report the test structure... Do not modify files." })

  Investigating from two angles — I'll report back with findings.

[Task Notification]
Task ID: agent-a1b
Status: completed
Summary: Found null pointer in src/auth/validate.ts:42
Result: Found null pointer in src/auth/validate.ts:42. The user field on Session is undefined when the session expires but...
[/Task Notification]

You:
  Found the bug — null pointer in validate.ts:42.

  Agent({ description: "Fix auth bug", worker_type: "coordinator_worker", prompt: "Fix the null pointer in src/auth/validate.ts:42. Add a null check before accessing user.id... Commit and report the hash." })

  Fix is in progress.`

export interface CoordinatorWorkerConfig {
  maxConcurrentWorkers: number
  defaultTimeoutMs: number
  workerTools: string[]
}

export const DEFAULT_COORDINATOR_CONFIG: CoordinatorWorkerConfig = {
  maxConcurrentWorkers: 5,
  defaultTimeoutMs: 10 * 60 * 1000, // 10 minutes
  workerTools: [
    "read",
    "glob",
    "grep",
    "bash",
    "edit",
    "write",
    "websearch",
    "webfetch",
    "codesearch",
  ],
}

export interface WorkerSpawnParams {
  description: string
  prompt: string
  timeoutMs?: number
  allowedTools?: string[]
}

export interface TaskNotification {
  taskId: string
  status: "completed" | "failed" | "interrupted"
  summary: string
  result?: string
  usage?: {
    totalTokens: number
    toolUses: number
    durationMs: number
  }
}

export interface CoordinatorState {
  activeWorkers: Map<string, {
    description: string
    startedAt: number
    timeoutMs: number
  }>
  completedTasks: TaskNotification[]
}

export class CoordinatorService extends Context.Service<CoordinatorService>()("@opencode/Coordinator") {
  private state: CoordinatorState = {
    activeWorkers: new Map(),
    completedTasks: [],
  }

  readonly spawnWorker: (params: WorkerSpawnParams) => Effect.Effect<string>
  readonly getWorkerStatus: (workerId: string) => Effect.Effect<TaskNotification | undefined>
  readonly stopWorker: (workerId: string) => Effect.Effect<void>
  readonly waitForWorker: (workerId: string) => Effect.Effect<TaskNotification>
  readonly getActiveWorkers: () => Effect.Effect<Array<{ id: string; description: string; startedAt: number }>>
}

export const coordinatorAgentInfo: AgentInfo = {
  name: "coordinator",
  description: "Coordinator agent for multi-worker task orchestration",
  permission: {
    tools: ["agent", "task", "tasklist", "messageteam"],
    allow: [],
    deny: [],
  },
  mode: "coordinator",
  native: true,
}

export function createCoordinatorAgent(): AgentInfo {
  return {
    ...coordinatorAgentInfo,
    systemPrompt: COORDINATOR_SYSTEM_PROMPT,
  }
}

export function parseTaskNotification(content: string): TaskNotification | null {
  const taskMatch = content.match(/\[Task Notification\]([\s\S]*?)\[\/Task Notification\]/)
  if (!taskMatch) return null

  const block = taskMatch[1]
  const taskIdMatch = block.match(/Task ID:\s*(.+)/)
  const statusMatch = block.match(/Status:\s*(completed|failed|interrupted)/)
  const summaryMatch = block.match(/Summary:\s*(.+)/)
  const resultMatch = block.match(/Result:\s*([\s\S]*?)(?=\[Usage\]|$)/)

  if (!taskIdMatch || !statusMatch || !summaryMatch) return null

  return {
    taskId: taskIdMatch[1].trim(),
    status: statusMatch[1] as TaskNotification["status"],
    summary: summaryMatch[1].trim(),
    result: resultMatch?.[1]?.trim(),
  }
}

export function formatWorkerPrompt(
  prompt: string,
  context: {
    cwd: string
    taskDescription?: string
    completedTasks?: TaskNotification[]
  }
): string {
  let formatted = prompt

  if (context.taskDescription) {
    formatted = `## Task\n${context.taskDescription}\n\n## Instructions\n${formatted}`
  }

  if (context.completedTasks && context.completedTasks.length > 0) {
    const completedSummary = context.completedTasks
      .map(t => `- ${t.taskId}: ${t.summary}`)
      .join("\n")
    formatted += `\n\n## Completed Tasks\n${completedSummary}`
  }

  formatted += `\n\n## Working Directory\n${context.cwd}`

  return formatted
}
