/**
 * Reminder Module
 *
 * Extracted from session/prompt.ts
 * Manages reminder/plan-text budget for prompt injection
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
    const entry: ReminderEntry = {
      text,
      importance,
      timestamp: Date.now(),
    }
    this.entries.push(entry)
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

    // Evict lowest importance reminders until we fit the budget
    while (this.entries.length > 0) {
      const totalChars = this.entries.reduce((sum, r) => sum + r.text.length, 0)
      if (totalChars <= targetChars) break
      this.entries.shift()
    }
  }
}

// Default global reminder budget instance
export const defaultReminderBudget = new ReminderBudget()

// Legacy function wrappers for backward compatibility
export function addReminder(text: string, importance: number): void {
  defaultReminderBudget.add(text, importance)
}

export function getReminders(): string[] {
  return defaultReminderBudget.getAll()
}

export function clearReminders(): void {
  defaultReminderBudget.clear()
}
