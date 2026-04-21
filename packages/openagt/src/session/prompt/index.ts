/**
 * Session Prompt Module
 *
 * This module re-exports extracted submodules from session/prompt.ts
 * Each submodule handles a specific responsibility from the original monolithic file.
 */

// Re-export reminder budget
export {
  ReminderBudget,
  defaultReminderBudget,
  addReminder,
  getReminders,
  clearReminders,
  type ReminderEntry,
} from "./reminder"

// Re-export command templates
export {
  processTemplate,
  hasTemplateVariables,
  extractTemplateVariables,
  validateTemplate,
  type CommandTemplateContext,
} from "./command"

// Re-export tool scheduling
export {
  type RunningToolCall,
  type ToolSchedulerOptions,
  type ToolSchedule,
  hasPathOverlap,
  detectConflicts,
  partitionTools,
  scheduleTools,
  isWriteTool,
} from "./tool-scheduler"

// Re-export tool resolution
export {
  type RunningToolCall as ResolvedToolCall,
  type ToolResolutionContext,
  type ToolContext,
  createToolScheduler,
  isConcurrencySafe,
  extractPathsFromInput,
} from "./tool-resolution"

// Re-export model selection
export { getModel, getLastModel } from "./model-selection"

// Re-export constants
export { REMINDER_TOKEN_BUDGET } from "./reminder"
