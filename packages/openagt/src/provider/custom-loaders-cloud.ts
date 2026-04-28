// Custom loaders for cloud platform providers with provider-specific auth vars.
// This file does not cover Bedrock credential chains, GitLab discovery, or Cloudflare gateways.

import { Effect } from "effect"
import { withProcessEnv } from "@/util/process-env"
import type { Info } from "./provider"
import type { CustomDep, CustomLoader } from "./custom-loader-types"

export function cloudCustomLoaders(dep: CustomDep): Record<string, CustomLoader> {
  return {
    "google-vertex": Effect.fnUntraced(function* (provider: Info) {
      const env = yield* dep.env()
      const project =
        provider.options?.project ?? env["GOOGLE_CLOUD_PROJECT"] ?? env["GCP_PROJECT"] ?? env["GCLOUD_PROJECT"]

      const location = String(
        provider.options?.location ??
          env["GOOGLE_VERTEX_LOCATION"] ??
          env["GOOGLE_CLOUD_LOCATION"] ??
          env["VERTEX_LOCATION"] ??
          "us-central1",
      )

      const autoload = Boolean(project)
      if (!autoload) return { autoload: false }
      return {
        autoload: true,
        vars(_options: Record<string, any>) {
          const endpoint = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`
          return {
            ...(project && { GOOGLE_VERTEX_PROJECT: project }),
            GOOGLE_VERTEX_LOCATION: location,
            GOOGLE_VERTEX_ENDPOINT: endpoint,
          }
        },
        options: {
          project,
          location,
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const { GoogleAuth } = await import("google-auth-library")
            const auth = new GoogleAuth()
            const client = await auth.getApplicationDefault()
            const token = await client.credential.getAccessToken()

            const headers = new Headers(init?.headers)
            headers.set("Authorization", `Bearer ${token.token}`)

            return fetch(input, { ...init, headers })
          },
        },
        async getModel(sdk: any, modelID: string) {
          const id = String(modelID).trim()
          return sdk.languageModel(id)
        },
      }
    }),
    "google-vertex-anthropic": Effect.fnUntraced(function* () {
      const env = yield* dep.env()
      const project = env["GOOGLE_CLOUD_PROJECT"] ?? env["GCP_PROJECT"] ?? env["GCLOUD_PROJECT"]
      const location = env["GOOGLE_CLOUD_LOCATION"] ?? env["VERTEX_LOCATION"] ?? "global"
      const autoload = Boolean(project)
      if (!autoload) return { autoload: false }
      return {
        autoload: true,
        options: {
          project,
          location,
        },
        async getModel(sdk: any, modelID) {
          const id = String(modelID).trim()
          return sdk.languageModel(id)
        },
      }
    }),
    "sap-ai-core": Effect.fnUntraced(function* () {
      const auth = yield* dep.auth("sap-ai-core")
      const env = yield* dep.env()
      const envServiceKey = env["AICORE_SERVICE_KEY"] ?? (auth?.type === "api" ? auth.key : undefined)
      const deploymentId = env["AICORE_DEPLOYMENT_ID"]
      const resourceGroup = env["AICORE_RESOURCE_GROUP"]

      return {
        autoload: !!envServiceKey,
        options: envServiceKey ? { deploymentId, resourceGroup, serviceKey: envServiceKey } : {},
        async getModel(sdk: any, modelID: string) {
          if (auth?.type !== "api") return sdk(modelID)
          return Effect.runPromise(
            withProcessEnv(
              { AICORE_SERVICE_KEY: auth.key },
              Effect.sync(() => sdk(modelID)),
            ),
          )
        },
      }
    }),
  }
}
