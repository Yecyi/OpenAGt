import type * as Provider from "./provider"

export function isNearAI(model: Pick<Provider.Model, "providerID" | "api">): boolean {
  if (model.providerID === "nearai") return true
  return model.api.url.includes("cloud-api.near.ai")
}
