import { Semaphore } from "effect"

export class SnapshotLockRegistry {
  private readonly locks = new Map<string, Semaphore.Semaphore>()

  lock(key: string): Semaphore.Semaphore {
    const hit = this.locks.get(key)
    if (hit) return hit

    const next = Semaphore.makeUnsafe(1)
    this.locks.set(key, next)
    return next
  }
}
