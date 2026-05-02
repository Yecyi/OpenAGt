/**
 * Reminder Module
 *
 * Extracted from session/prompt.ts.
 * Manages reminder/plan-text budget for prompt injection.
 *
 * Budgets are keyed by sessionID so reminders accumulated in one session
 * don't leak into another. Use `installLifecycleHooks(unsubFn)` from a layer
 * setup so the per-session map is freed on Session.Event.Deleted.
 *
 * Wave 8: split into two pools per Veseli 2025's attention positional bias
 * finding (when context >50% full, distance from end decides retrievability).
 *
 *   - Safety pool: hard constraints the harness must always surface
 *     (plan-mode block, permission-deny, dangerous-shell warnings).
 *     Never evicted. Bounded at SAFETY_REMINDER_TOKEN_BUDGET tokens.
 *   - Info pool: existing importance-evicted reminders (plan/build switching,
 *     general workflow nudges). Bounded at INFO_REMINDER_TOKEN_BUDGET tokens.
 *
 * Total reminder cap = SAFETY + INFO = 2000 tokens (unchanged from pre-split
 * total). Safety reservation guarantees a baseline of safety-class messages
 * even when info-class reminders are aggressively pushed.
 */

const REMINDER_CHARS_PER_TOKEN = 4
// Reserved for never-evicted safety reminders (plan-mode, permission, etc.).
const SAFETY_REMINDER_TOKEN_BUDGET = 512
// Existing importance-evicted budget; reduced from 2000 to keep total at 2000.
const INFO_REMINDER_TOKEN_BUDGET = 1488

export interface ReminderEntry {
  text: string
  importance: number
  timestamp: number
  safety: boolean
}

/**
 * In-memory reminder budget tracker
 *
 * Maintains two pools:
 *   - safety entries (never evicted, hard cap at SAFETY budget)
 *   - info entries (importance + FIFO eviction, hard cap at INFO budget)
 *
 * `getAll()` returns safety entries first (turn-tail position, attention
 * priority per Veseli 2025) followed by info entries.
 */
export class ReminderBudget {
  private safetyEntries: ReminderEntry[] = []
  private infoEntries: ReminderEntry[] = []

  /**
   * Add a reminder. Default tier is "info" (importance-evicted).
   * Pass safety: true for hard safety constraints that must not be evicted.
   */
  add(text: string, importance: number, options: { safety?: boolean } = {}): void {
    const safety = options.safety ?? false
    const entry: ReminderEntry = { text, importance, timestamp: Date.now(), safety }
    if (safety) {
      this.safetyEntries.push(entry)
      this.enforceSafety()
    } else {
      this.infoEntries.push(entry)
      this.enforceInfo()
    }
  }

  /**
   * Get all reminders as text array. Safety entries surface first so the
   * combined string puts them at the top of the reminder section
   * (turn-tail position when this section sits at the user-message tail).
   */
  getAll(): string[] {
    return [...this.safetyEntries.map((e) => e.text), ...this.infoEntries.map((e) => e.text)]
  }

  /**
   * Clear all reminders (both pools).
   */
  clear(): void {
    this.safetyEntries = []
    this.infoEntries = []
  }

  /**
   * Get total character count across both pools.
   */
  get totalChars(): number {
    const safety = this.safetyEntries.reduce((sum, r) => sum + r.text.length, 0)
    const info = this.infoEntries.reduce((sum, r) => sum + r.text.length, 0)
    return safety + info
  }

  /**
   * Get total estimated tokens across both pools.
   */
  get totalTokens(): number {
    return Math.ceil(this.totalChars / REMINDER_CHARS_PER_TOKEN)
  }

  /**
   * Get remaining info-pool budget in characters. Safety pool has its own
   * bookkeeping; this is the budget for new info-class entries.
   */
  get remainingChars(): number {
    const targetChars = INFO_REMINDER_TOKEN_BUDGET * REMINDER_CHARS_PER_TOKEN
    const used = this.infoEntries.reduce((sum, r) => sum + r.text.length, 0)
    return Math.max(0, targetChars - used)
  }

  /**
   * Safety pool: bounded eviction by FIFO only (oldest first). Importance
   * doesn't apply — safety reminders are inherently load-bearing. The
   * SAFETY budget should be sized so this rarely needs to evict; if it
   * does, the oldest safety reminder is the one most likely already
   * acknowledged or stale.
   */
  private enforceSafety(): void {
    const targetChars = SAFETY_REMINDER_TOKEN_BUDGET * REMINDER_CHARS_PER_TOKEN
    this.safetyEntries.sort((a, b) => a.timestamp - b.timestamp)
    while (this.safetyEntries.length > 0) {
      const totalChars = this.safetyEntries.reduce((sum, r) => sum + r.text.length, 0)
      if (totalChars <= targetChars) break
      this.safetyEntries.shift()
    }
  }

  /**
   * Info pool: importance-then-timestamp eviction (existing behavior,
   * preserved unchanged from pre-Wave-8 ReminderBudget).
   */
  private enforceInfo(): void {
    const targetChars = INFO_REMINDER_TOKEN_BUDGET * REMINDER_CHARS_PER_TOKEN
    this.infoEntries.sort((a, b) => {
      if (a.importance !== b.importance) return a.importance - b.importance
      return a.timestamp - b.timestamp
    })
    while (this.infoEntries.length > 0) {
      const totalChars = this.infoEntries.reduce((sum, r) => sum + r.text.length, 0)
      if (totalChars <= targetChars) break
      this.infoEntries.shift()
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

// Wave 8: explicit safety-tier helper. Safety reminders go into the
// never-evicted pool and surface first in getAll() output. Use for
// plan-mode blocks, permission-deny notices, and dangerous-shell warnings —
// anything the harness must always be allowed to surface.
export function addSafetyReminder(text: string, importance: number, sessionID?: string): void {
  const budget = sessionID ? getBudget(sessionID) : defaultReminderBudget
  budget.add(text, importance, { safety: true })
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
