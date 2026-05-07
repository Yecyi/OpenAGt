export function normalizeFailureText(text: string) {
  return text
    .toLowerCase()
    .replace(/`{3}[\s\S]*?`{3}/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[0-9a-f]{7,40}\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .match(/[\p{L}\p{N}_-]{3,}/gu)
    ?.slice(0, 256)
    .join(" ") ?? ""
}

function fnv1a32(text: string, seed: number) {
  return Array.from(text).reduce((hash, char) => {
    const next = hash ^ char.codePointAt(0)!
    return Math.imul(next, 0x01000193) >>> 0
  }, seed >>> 0)
}

function tokenHash64(token: string) {
  return (BigInt(fnv1a32(token, 0x811c9dc5)) << 32n) | BigInt(fnv1a32(token, 0x9e3779b9))
}

export function simHash64(text: string) {
  const tokens = normalizeFailureText(text).split(" ").filter(Boolean)
  if (tokens.length === 0) return "0000000000000000"
  const weights = Array.from({ length: 64 }, () => 0)
  for (const token of tokens) {
    const hash = tokenHash64(token)
    for (const bit of Array.from({ length: 64 }, (_, index) => index)) {
      weights[bit]! += (hash & (1n << BigInt(bit))) === 0n ? -1 : 1
    }
  }
  const signature = weights.reduce(
    (acc, weight, bit) => (weight >= 0 ? acc | (1n << BigInt(bit)) : acc),
    0n,
  )
  return signature.toString(16).padStart(16, "0").slice(-16)
}

export function hammingDistance64(left: string, right: string) {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`)
  return Array.from({ length: 64 }, () => 0).reduce((count) => {
    const next = count + Number(value & 1n)
    value >>= 1n
    return next
  }, 0)
}

export function failureSignature(input: {
  verdict?: string
  text?: string
  unsupportedClaims?: readonly string[]
  missingEvidence?: readonly string[]
  contradictions?: readonly string[]
  requiredChanges?: readonly string[]
}) {
  return simHash64(
    [
      input.verdict,
      input.text,
      ...(input.unsupportedClaims ?? []),
      ...(input.missingEvidence ?? []),
      ...(input.contradictions ?? []),
      ...(input.requiredChanges ?? []),
    ]
      .filter((item): item is string => Boolean(item))
      .join("\n"),
  )
}
