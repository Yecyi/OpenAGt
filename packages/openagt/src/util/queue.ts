export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: Array<(value: T | undefined) => void> = []
  private closed = false

  constructor(private readonly capacity = Number.POSITIVE_INFINITY) {}

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else {
      if (this.queue.length >= this.capacity) this.queue.shift()
      this.queue.push(item)
    }
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
    if (this.closed) return Promise.reject(new Error("AsyncQueue is closed"))
    return new Promise((resolve, reject) =>
      this.resolvers.push((value) => (value === undefined ? reject(new Error("AsyncQueue is closed")) : resolve(value))),
    )
  }

  take(signal?: AbortSignal): Promise<T | undefined> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift())
    if (this.closed) return Promise.resolve(undefined)
    return new Promise((resolve) => {
      let resolver: ((value: T | undefined) => void) | undefined
      const abort = () => {
        if (resolver) this.resolvers = this.resolvers.filter((item) => item !== resolver)
        resolve(undefined)
      }
      resolver = (value: T | undefined) => {
        signal?.removeEventListener("abort", abort)
        resolve(value)
      }
      signal?.addEventListener("abort", abort, { once: true })
      this.resolvers.push(resolver)
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const resolve of this.resolvers.splice(0)) resolve(undefined)
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const item = await this.take()
      if (item === undefined) return
      yield item
    }
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}
