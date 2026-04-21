import { describe, expect, test } from "bun:test"
import {
  checkToolQuality,
  checkToolsQuality,
  generateToolDocumentation,
  type ToolQualityReport,
} from "../../src/mcp/tool-quality"

describe("checkToolQuality", () => {
  test("passes for high quality tool", () => {
    const tool = {
      name: "get_user_info",
      description: "Retrieves user information from the database with proper validation",
      inputSchema: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "The unique identifier of the user",
          },
          includeProfile: {
            type: "boolean",
            description: "Include profile data",
          },
        },
        required: ["userId"],
      },
    }

    const report = checkToolQuality(tool as any, "test-client")

    expect(report.overallScore).toBeGreaterThanOrEqual(60)
    expect(report.checks.hasValidSchema).toBe(true)
    expect(report.checks.hasDescription).toBe(true)
    expect(report.checks.hasParameterDescriptions).toBe(true)
    expect(report.checks.isNamingConsistent).toBe(true)
  })

  test("fails for low quality tool", () => {
    const tool = {
      name: "x",
      description: "x",
      inputSchema: {
        type: "object",
        properties: {},
      },
    }

    const report = checkToolQuality(tool as any, "test-client")

    expect(report.overallScore).toBeLessThanOrEqual(50)
    expect(report.issues.length).toBeGreaterThan(0)
  })

  test("detects consistent naming", () => {
    const tool = {
      name: "do_that_thing",
      description: "A tool",
      inputSchema: {
        type: "object",
        properties: {},
      },
    }

    const report = checkToolQuality(tool as any, "test-client")

    expect(report.checks.isNamingConsistent).toBe(true)
  })

  test("detects deprecation warning", () => {
    const tool = {
      name: "old_tool",
      description: "This tool is deprecated, use new_tool instead",
      inputSchema: {
        type: "object",
        properties: {},
      },
    }

    const report = checkToolQuality(tool as any, "test-client")

    expect(report.checks.hasDeprecationWarning).toBe(true)
  })
})

describe("checkToolsQuality", () => {
  test("aggregates results correctly", () => {
    const tools = [
      {
        tool: {
          name: "good_tool",
          description: "A well documented tool",
          inputSchema: {
            type: "object",
            properties: {
              param: { type: "string", description: "A parameter" },
            },
            required: ["param"],
          },
        },
        clientName: "client1",
      },
      {
        tool: {
          name: "bad_tool",
          inputSchema: {},
        },
        clientName: "client2",
      },
    ]

    const result = checkToolsQuality(tools as any)

    expect(result.reports.length).toBe(2)
    expect(result.averageScore).toBeLessThan(100)
    expect(result.averageScore).toBeGreaterThan(0)
    expect(result.highQualityTools.length).toBeGreaterThanOrEqual(0)
    expect(result.lowQualityTools.length).toBeGreaterThanOrEqual(1)
    expect(Object.keys(result.commonIssues).length).toBeGreaterThan(0)
  })

  test("handles empty tools array", () => {
    const result = checkToolsQuality([])

    expect(result.reports.length).toBe(0)
    expect(result.averageScore).toBe(0)
    expect(result.highQualityTools.length).toBe(0)
    expect(result.lowQualityTools.length).toBe(0)
  })
})

describe("generateToolDocumentation", () => {
  test("generates documentation for complete tool", () => {
    const tool = {
      name: "get_user",
      description: "Retrieves user information",
      inputSchema: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User identifier",
          },
          includeProfile: {
            type: "boolean",
            description: "Include profile data",
            enum: [true, false],
          },
        },
        required: ["userId"],
      },
    }

    const doc = generateToolDocumentation(tool as any, "test-client")

    expect(doc).toContain("## get_user")
    expect(doc).toContain("**Client:** test-client")
    expect(doc).toContain("### Description")
    expect(doc).toContain("Retrieves user information")
    expect(doc).toContain("### Parameters")
    expect(doc).toContain("userId")
    expect(doc).toContain("(required)")
    expect(doc).toContain("includeProfile")
  })

  test("handles missing description", () => {
    const tool = {
      name: "simple_tool",
      inputSchema: {},
    }

    const doc = generateToolDocumentation(tool as any, "client")

    expect(doc).toContain("## simple_tool")
    expect(doc).toContain("_No description provided_")
  })

  test("handles enum values", () => {
    const tool = {
      name: "filter_tool",
      description: "Filters data",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Filter status",
            enum: ["active", "inactive", "pending"],
          },
        },
      },
    }

    const doc = generateToolDocumentation(tool as any, "client")

    expect(doc).toContain("Options: active, inactive, pending")
  })
})

describe("scoring", () => {
  test("perfect score for complete tool", () => {
    const tool = {
      name: "perfect_tool",
      description: "A perfect tool with all quality attributes properly defined",
      inputSchema: {
        type: "object",
        properties: {
          param1: { type: "string", description: "Parameter 1" },
        },
        required: ["param1"],
      },
    }

    const report = checkToolQuality(tool as any, "client")

    expect(report.overallScore).toBeGreaterThanOrEqual(60)
  })

  test("low score for minimal tool", () => {
    const tool = {
      name: "x",
      inputSchema: {},
    }

    const report = checkToolQuality(tool as any, "client")

    expect(report.overallScore).toBeLessThan(40)
  })
})
