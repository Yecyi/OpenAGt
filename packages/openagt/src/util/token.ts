export function estimate(input: string) {
  if (!input) return 0
  let score = 0
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0
    if (/\s/.test(char)) score += 0.2
    else if (code <= 0x007f) score += 0.25
    else if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) score += 1
    else score += 0.75
  }
  return Math.max(0, Math.ceil(score))
}
