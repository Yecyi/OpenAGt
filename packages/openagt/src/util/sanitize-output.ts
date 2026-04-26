import stripAnsi from "strip-ansi"

const CONTROL_SAFE = new Set([0x09, 0x0a, 0x0d])
const OSC_SEQUENCE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g
const DCS_SEQUENCE = /\x1b[P_^X][\s\S]*?\x1b\\/g

export function sanitizeTerminalOutput(input: string) {
  const withoutEscapes = stripAnsi(input.replace(OSC_SEQUENCE, "").replace(DCS_SEQUENCE, ""))
  return Array.from(withoutEscapes)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      if (CONTROL_SAFE.has(code)) return true
      if (code < 0x20) return false
      if (code >= 0x7f && code <= 0x9f) return false
      return true
    })
    .join("")
}

