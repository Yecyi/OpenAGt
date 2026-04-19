/**
 * Task Management Tools
 *
 * Provides task list management tools similar to Claude Code's TaskTool suite.
 * Includes task creation, listing, updating, getting, and stopping capabilities.
 */

import { Effect, Context } from "effect"
import { Tool, ToolCall, ToolResult } from "./tool"
import { Log } from "@/util"
import { z } from "zod"

const log = Log.create({ service: "tool.task" })

// Tool names matching CC conventions
export const TASK_CREATE_TOOL_NAME = "TaskCreate"
export const TASK_LIST_TOOL_NAME = "TaskList"
export const TASK_GET_TOOL_NAME = "TaskGet"
export const TASK_UPDATE_TOOL_NAME = "TaskUpdate"
export const TASK_STOP_TOOL_NAME = "TaskStop"

export interface Task {
  id: string
  subject: string
  description?: string
  status: "pending" | "in_progress" | "completed" | "failed" | "blocked"
  blockedBy: string[]
  blocking: string[]
  owner?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  metadata?: Record<string, unknown>
}

export interface TaskList {
  id: string
  name: string
  tasks: Task[]
}

// Task state management (in-memory for now, can be persisted)
const taskLists = new Map<string, TaskList>()
const tasks = new Map<string, Task>()

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// ============================================================================
// TaskCreate Tool
// ============================================================================

const taskCreateInputSchema = z.object({
  subject: z.string().describe("A brief title for the task"),
  description: z.string().optional().describe("What needs to be done"),
  activeForm: z.string().optional().describe("Present continuous form shown in spinner"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Arbitrary metadata"),
  blockedBy: z.array(z.string()).optional().describe("Task IDs this task is blocked by"),
})

const taskCreateOutputSchema = z.object({
  task: z.object({
    id: z.string(),
    subject: z.string(),
  }),
})

export type TaskCreateInput = z.infer<typeof taskCreateInputSchema>
export type TaskCreateOutput = z.infer<typeof taskCreateOutputSchema>

export const taskCreateTool: Tool = {
  name: TASK_CREATE_TOOL_NAME,
  description: "Create a new task in the task list",
  inputSchema: taskCreateInputSchema,
  outputSchema: taskCreateOutputSchema,

  execute: (input: TaskCreateInput, context: Tool.Context) => {
    return Effect.gen(function* () {
      const id = generateTaskId()
      const now = Date.now()

      const task: Task = {
        id,
        subject: input.subject,
        description: input.description,
        status: "pending",
        blockedBy: input.blockedBy ?? [],
        blocking: [],
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata,
      }

      tasks.set(id, task)

      // Update blocking relationships
      for (const blockedId of task.blockedBy) {
        const blockedTask = tasks.get(blockedId)
        if (blockedTask) {
          blockedTask.blocking.push(id)
        }
      }

      log.debug("task created", { id, subject: input.subject })

      return {
        task: {
          id,
          subject: input.subject,
        },
      }
    })
  },
}

// ============================================================================
// TaskList Tool
// ============================================================================

const taskListInputSchema = z.object({
  status: z
    .enum(["pending", "in_progress", "completed", "failed", "blocked"])
    .optional()
    .describe("Filter by status"),
  owner: z.string().optional().describe("Filter by owner"),
})

const taskListOutputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      status: z.string(),
      blockedBy: z.array(z.string()),
      blocking: z.array(z.string()),
      owner: z.string().optional(),
      createdAt: z.number(),
      updatedAt: z.number(),
    })
  ),
})

export type TaskListInput = z.infer<typeof taskListInputSchema>
export type TaskListOutput = z.infer<typeof taskListOutputSchema>

export const taskListTool: Tool = {
  name: TASK_LIST_TOOL_NAME,
  description: "List all tasks or filter by status/owner",
  inputSchema: taskListInputSchema,
  outputSchema: taskListOutputSchema,

  execute: (input: TaskListInput, context: Tool.Context) => {
    return Effect.gen(function* () {
      let allTasks = Array.from(tasks.values())

      // Apply filters
      if (input.status) {
        allTasks = allTasks.filter((t) => t.status === input.status)
      }
      if (input.owner) {
        allTasks = allTasks.filter((t) => t.owner === input.owner)
      }

      // Sort by creation time
      allTasks.sort((a, b) => a.createdAt - b.createdAt)

      return {
        tasks: allTasks.map((t) => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          blockedBy: t.blockedBy,
          blocking: t.blocking,
          owner: t.owner,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      }
    })
  },
}

// ============================================================================
// TaskGet Tool
// ============================================================================

const taskGetInputSchema = z.object({
  taskId: z.string().describe("The ID of the task to get"),
})

const taskGetOutputSchema = z.object({
  task: z.object({
    id: z.string(),
    subject: z.string(),
    description: z.string().optional(),
    status: z.string(),
    blockedBy: z.array(z.string()),
    blocking: z.array(z.string()),
    owner: z.string().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
})

export type TaskGetInput = z.infer<typeof taskGetInputSchema>
export type TaskGetOutput = z.infer<typeof taskGetOutputSchema>

export const taskGetTool: Tool = {
  name: TASK_GET_TOOL_NAME,
  description: "Get details of a specific task",
  inputSchema: taskGetInputSchema,
  outputSchema: taskGetOutputSchema,

  execute: (input: TaskGetInput, context: Tool.Context) => {
    return Effect.gen(function* () {
      const task = tasks.get(input.taskId)

      if (!task) {
        return {
          error: `Task not found: ${input.taskId}`,
        }
      }

      return {
        task: {
          id: task.id,
          subject: task.subject,
          description: task.description,
          status: task.status,
          blockedBy: task.blockedBy,
          blocking: task.blocking,
          owner: task.owner,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          completedAt: task.completedAt,
          metadata: task.metadata,
        },
      }
    })
  },
}

// ============================================================================
// TaskUpdate Tool
// ============================================================================

const taskUpdateInputSchema = z.object({
  taskId: z.string().describe("The ID of the task to update"),
  subject: z.string().optional().describe("New title"),
  description: z.string().optional().describe("New description"),
  status: z
    .enum(["pending", "in_progress", "completed", "failed", "blocked"])
    .optional()
    .describe("New status"),
  owner: z.string().optional().describe("Assign to owner"),
})

const taskUpdateOutputSchema = z.object({
  task: z.object({
    id: z.string(),
    subject: z.string(),
    status: z.string(),
  }),
})

export type TaskUpdateInput = z.infer<typeof taskUpdateInputSchema>
export type TaskUpdateOutput = z.infer<typeof taskUpdateOutputSchema>

export const taskUpdateTool: Tool = {
  name: TASK_UPDATE_TOOL_NAME,
  description: "Update a task's properties",
  inputSchema: taskUpdateInputSchema,
  outputSchema: taskUpdateOutputSchema,

  execute: (input: TaskUpdateInput, context: Tool.Context) => {
    return Effect.gen(function* () {
      const task = tasks.get(input.taskId)

      if (!task) {
        return {
          error: `Task not found: ${input.taskId}`,
        }
      }

      // Update fields
      if (input.subject !== undefined) {
        task.subject = input.subject
      }
      if (input.description !== undefined) {
        task.description = input.description
      }
      if (input.status !== undefined) {
        task.status = input.status
        if (input.status === "completed") {
          task.completedAt = Date.now()
        }
      }
      if (input.owner !== undefined) {
        task.owner = input.owner
      }
      task.updatedAt = Date.now()

      log.debug("task updated", { id: task.id, status: task.status })

      return {
        task: {
          id: task.id,
          subject: task.subject,
          status: task.status,
        },
      }
    })
  },
}

// ============================================================================
// TaskStop Tool
// ============================================================================

const taskStopInputSchema = z.object({
  taskId: z.string().describe("The ID of the task to stop"),
  reason: z.string().optional().describe("Reason for stopping"),
})

const taskStopOutputSchema = z.object({
  task: z.object({
    id: z.string(),
    status: z.string(),
    stoppedAt: z.number(),
  }),
})

export type TaskStopInput = z.infer<typeof taskStopInputSchema>
export type TaskStopOutput = z.infer<typeof taskStopOutputSchema>

export const taskStopTool: Tool = {
  name: TASK_STOP_TOOL_NAME,
  description: "Stop a running task",
  inputSchema: taskStopInputSchema,
  outputSchema: taskStopOutputSchema,

  execute: (input: TaskStopInput, context: Tool.Context) => {
    return Effect.gen(function* () {
      const task = tasks.get(input.taskId)

      if (!task) {
        return {
          error: `Task not found: ${input.taskId}`,
        }
      }

      task.status = "blocked"
      task.updatedAt = Date.now()

      log.info("task stopped", { id: task.id, reason: input.reason })

      return {
        task: {
          id: task.id,
          status: task.status,
          stoppedAt: task.updatedAt,
        },
      }
    })
  },
}

// ============================================================================
// Export all tools
// ============================================================================

export const taskTools = [
  taskCreateTool,
  taskListTool,
  taskGetTool,
  taskUpdateTool,
  taskStopTool,
]

// Task claim helper
export async function claimTask(
  taskListId: string,
  taskId: string,
  agentName: string
): Promise<{ success: boolean; reason?: string }> {
  const task = tasks.get(taskId)
  if (!task) {
    return { success: false, reason: "Task not found" }
  }
  if (task.status !== "pending") {
    return { success: false, reason: `Task is ${task.status}` }
  }
  if (task.blockedBy.some((id) => tasks.get(id)?.status !== "completed")) {
    return { success: false, reason: "Task is blocked" }
  }

  task.owner = agentName
  task.status = "in_progress"
  task.updatedAt = Date.now()

  return { success: true }
}

// Get available (unblocked, unowned) tasks
export function getAvailableTasks(): Task[] {
  return Array.from(tasks.values()).filter((task) => {
    if (task.status !== "pending") return false
    if (task.owner) return false
    return task.blockedBy.every(
      (id) => tasks.get(id)?.status === "completed"
    )
  })
}
