// Shared budget for combined stdout+stderr cap. Both collectStream invocations
// inside one spawn pass the same SharedBudget instance so the per-stream
// truncation cooperates with the combined cap. The reader still drains the
// underlying stream once the budget is exhausted to avoid blocking the child
// process; only the chunk-keeping stops.
export interface SharedBudget {
  remaining: number
  truncated: boolean
}

export async function collectStream(
  stream: ReadableStream<Uint8Array> | null,
  maxSize?: number,
  combined?: SharedBudget,
) {
  if (!stream) {
    return { text: "", truncated: false }
  }

  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let total = 0
  let truncated = false

  while (true) {
    const next = await reader.read().catch(() => ({ done: true, value: undefined }))
    if (next.done || !next.value) break

    const chunk = next.value
    const perStreamRemaining = maxSize === undefined ? Infinity : maxSize - total
    const combinedRemaining = combined ? combined.remaining : Infinity
    const allowed = Math.min(chunk.byteLength, perStreamRemaining, combinedRemaining)

    if (allowed <= 0) {
      if (perStreamRemaining <= 0) truncated = true
      if (combined && combinedRemaining <= 0) combined.truncated = true
      continue
    }

    if (allowed < chunk.byteLength) {
      chunks.push(chunk.slice(0, allowed))
      total += allowed
      if (combined) combined.remaining -= allowed
      if (allowed === perStreamRemaining) truncated = true
      if (combined && allowed === combinedRemaining) combined.truncated = true
      continue
    }

    chunks.push(chunk)
    total += allowed
    if (combined) combined.remaining -= allowed
  }

  return {
    text: new TextDecoder().decode(Bun.concatArrayBuffers(chunks)),
    truncated,
  }
}

export function truncateOutput(value: string, maxSize?: number) {
  if (!maxSize || value.length <= maxSize) {
    return { text: value, truncated: false }
  }
  return { text: value.slice(0, maxSize), truncated: true }
}
