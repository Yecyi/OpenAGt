// Normalizes JSON schema payloads for provider-specific API constraints.
// It does not choose models, mutate provider catalogs, or build generation options.
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"

type SchemaModel = {
  providerID: string
  api: {
    id: string
  }
}

function isPlainObject(node: unknown): node is Record<string, any> {
  return typeof node === "object" && node !== null && !Array.isArray(node)
}

function hasCombiner(node: unknown) {
  return isPlainObject(node) && (Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf))
}

function hasSchemaIntent(node: unknown) {
  if (!isPlainObject(node)) return false
  if (hasCombiner(node)) return true
  return [
    "type",
    "properties",
    "items",
    "prefixItems",
    "enum",
    "const",
    "$ref",
    "additionalProperties",
    "patternProperties",
    "required",
    "not",
    "if",
    "then",
    "else",
  ].some((key) => key in node)
}

function sanitizeGeminiSchema(obj: any): any {
  if (obj === null || typeof obj !== "object") {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeGeminiSchema)
  }

  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === "enum" && Array.isArray(value)) {
      // Convert all enum values to strings
      result[key] = value.map((v) => String(v))
      // If we have integer type with enum, change type to string
      if (result.type === "integer" || result.type === "number") {
        result.type = "string"
      }
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeGeminiSchema(value)
    } else {
      result[key] = value
    }
  }

  // Filter required array to only include fields that exist in properties
  if (result.type === "object" && result.properties && Array.isArray(result.required)) {
    result.required = result.required.filter((field: any) => field in result.properties)
  }

  if (result.type === "array" && !hasCombiner(result)) {
    if (result.items == null) {
      result.items = {}
    }
    // Ensure items has a type only when it's still schema-empty.
    if (isPlainObject(result.items) && !hasSchemaIntent(result.items)) {
      result.items.type = "string"
    }
  }

  // Remove properties/required from non-object types (Gemini rejects these)
  if (result.type && result.type !== "object" && !hasCombiner(result)) {
    delete result.properties
    delete result.required
  }

  return result
}

export function transformProviderSchema(model: SchemaModel, schema: JSONSchema.BaseSchema | JSONSchema7): JSONSchema7 {
  if (model.providerID === "google" || model.api.id.includes("gemini")) {
    return sanitizeGeminiSchema(schema) as JSONSchema7
  }
  return schema as JSONSchema7
}
