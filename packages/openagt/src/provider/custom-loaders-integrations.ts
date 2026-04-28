// Static integration headers for providers that need product attribution only.
// This file does not read auth, env, config, or construct SDK clients.

import { Effect } from "effect"
import type { CustomLoader } from "./custom-loader-types"

export function integrationHeaderLoaders(): Record<string, CustomLoader> {
  return {
    cerebras: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "X-Cerebras-3rd-Party-Integration": "opencode",
          },
        },
      }),
    kilo: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }),
  }
}
