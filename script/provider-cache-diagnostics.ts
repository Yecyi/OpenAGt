#!/usr/bin/env bun

function estimate(input: string) {
  if (!input) return 0
  return Math.max(
    0,
    Math.ceil(
      Array.from(input).reduce((score, char) => {
        const code = char.codePointAt(0) ?? 0
        if (/\s/.test(char)) return score + 0.2
        if (code <= 0x007f) return score + 0.25
        if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) return score + 1
        return score + 0.75
      }, 0),
    ),
  )
}

const messageTransform = await Bun.file("packages/openagt/src/provider/message-transform.ts").text()
const systemPrompt = await Bun.file("packages/openagt/src/session/system.ts").text()
const taskRuntimeHelpers = await Bun.file("packages/openagt/src/session/task-runtime-helpers.ts").text()
const sample = "你好世界🙂"

console.log(
  JSON.stringify(
    {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      cache_control: {
        has_cache_zone: messageTransform.includes("cacheZone"),
        has_cache_control_marker: messageTransform.includes("cacheControl"),
      },
      token_estimate: {
        estimate_source: "fallback_unicode_weighted",
        sample,
        estimate: estimate(sample),
        length_div_4: Math.ceil(sample.length / 4),
        system_prompt_uses_token_estimator: systemPrompt.includes("Token.estimate"),
      },
      anthropic_cache_accounting: {
        task_usage_provider_branch: taskRuntimeHelpers.includes('provider.includes("anthropic")'),
      },
    },
    null,
    2,
  ),
)
