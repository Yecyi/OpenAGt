// Custom loaders for routing/gateway providers with static request headers.
// This file does not read auth/config/env or instantiate provider SDKs.

import { Effect } from "effect"
import type { CustomLoader } from "./custom-loader-types"

export function routingCustomLoaders(): Record<string, CustomLoader> {
  return {
    llmgateway: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
            "X-Source": "opencode",
          },
        },
      }),
    openrouter: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }),
    vercel: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "http-referer": "https://opencode.ai/",
            "x-title": "opencode",
          },
        },
      }),
  }
}

export function zenmuxCustomLoader(): Record<string, CustomLoader> {
  return {
    zenmux: () =>
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
