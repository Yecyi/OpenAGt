export async function collectStream(stream: ReadableStream<Uint8Array> | null, maxSize?: number) {
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
    if (!maxSize) {
      chunks.push(chunk)
      continue
    }

    const remaining = maxSize - total
    if (remaining <= 0) {
      truncated = true
      continue
    }

    if (chunk.byteLength > remaining) {
      chunks.push(chunk.slice(0, remaining))
      total += remaining
      truncated = true
      continue
    }

    chunks.push(chunk)
    total += chunk.byteLength
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
