/**
 * Reminder Module
 *
 * Extracted from session/prompt.ts.
 * Manages reminder/plan-text budget for prompt injection.
 *
 * Budgets are keyed by sessionID so reminders accumulated in one session
 * don't leak into another. Use `installLifecycleHooks(unsubFn)` from a layer
 * setup so the per-session map is freed on Session.Event.Deleted.
 */

const REMINDER_TOKEN_BUDGET = 2000
const REMINDER_CHARS_PER_TOKEN = 4

export interface ReminderEntry {
  text: string
  importance: number
  timestamp: number
}

/**
 * In-memory reminder budget tracker
 * Manages importance-based reminders with token budget enforcement
 */
export class ReminderBudget {
  private entries: ReminderEntry[] = []

  /**
   * Add a reminder entry with automatic budget enforcement
   */
  add(text: string, importance: number): void {
    this.entries.push({ text, importance, timestamp: Date.now() })
    this.enforce()
  }

  /**
   * Get all reminders as text array
   */
  getAll(): string[] {
    return this.entries.map((e) => e.text)
  }

  /**
   * Clear all reminders
   */
  clear(): void {
    this.entries = []
  }

  /**
   * Get total character count
   */
  get totalChars(): number {
    return this.entries.reduce((sum, r) => sum + r.text.length, 0)
  }

  /**
   * Get total estimated tokens
   */
  get totalTokens(): number {
    return Math.ceil(this.totalChars / REMINDER_CHARS_PER_TOKEN)
  }

  /**
   * Get remaining budget in characters
   */
  get remainingChars(): number {
    const targetChars = REMINDER_TOKEN_BUDGET * REMINDER_CHARS_PER_TOKEN
    return Math.max(0, targetChars - this.totalChars)
  }

  /**
   * Enforce the token budget by evicting lowest importance entries
   */
  private enforce(): void {
    const targetChars = REMINDER_TOKEN_BUDGET * REMINDER_CHARS_PER_TOKEN

    // Sort by importance (lowest first) then timestamp (oldest first) for FIFO
    this.entries.sort((a, b) => {
      if (a.importance !== b.importance) return a.importance - b.importance
      return a.timestamp - b.timestamp
    })

    while (this.entries.length > 0) {
      const totalChars = this.entries.reduce((sum, r) => sum + r.text.length, 0)
      if (totalChars <= targetChars) break
      this.entries.shift()
    }
  }
}

// Per-session budgets keyed by sessionID.
const budgets = new Map<string, ReminderBudget>()

export function getBudget(sessionID: string): ReminderBudget {
  const existing = budgets.get(sessionID)
  if (existing) return existing
  const fresh = new ReminderBudget()
  budgets.set(sessionID, fresh)
  return fresh
}

export function clearBudget(sessionID: string): void {
  budgets.delete(sessionID)
}

export function clearAllBudgets(): void {
  budgets.clear()
}

// Default fallback budget for legacy call sites that have no sessionID in scope.
export const defaultReminderBudget = new ReminderBudget()

// Legacy function wrappers. When sessionID is omitted we fall back to the
// process-wide singleton; new callers should pass a sessionID to keep state
// scoped to a single session.
export function addReminder(text: string, importance: number, sessionID?: string): void {
  const budget = sessionID ? getBudget(sessionID) : defaultReminderBudget
  budget.add(text, importance)
}

export function getReminders(sessionID?: string): string[] {
  const budget = sessionID ? getBudget(sessionID) : defaultReminderBudget
  return budget.getAll()
}

export function clearReminders(sessionID?: string): void {
  if (sessionID) {
    clearBudget(sessionID)
    return
  }
  defaultReminderBudget.clear()
}
