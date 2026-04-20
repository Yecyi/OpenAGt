import { Context, Effect, Layer } from "effect"
import type { ShellSecurityResult } from "./shell-security"

export type ShellSafetyReviewInput = {
  command: string
  result: ShellSecurityResult
}

export type ShellSafetyReviewResult = {
  review_api_version: 1
  review_mode: "disabled"
  review_status: "not_requested"
}

export interface Interface {
  readonly review: (input: ShellSafetyReviewInput) => Effect.Effect<ShellSafetyReviewResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShellSafetyReview") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    review: () =>
      Effect.succeed({
        review_api_version: 1 as const,
        review_mode: "disabled" as const,
        review_status: "not_requested" as const,
      }),
  }),
)

export const defaultLayer = layer

export * as ShellSafetyReview from "./shell-review"
