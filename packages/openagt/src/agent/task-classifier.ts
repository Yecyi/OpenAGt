export const EffortLevelValue = ["low", "medium", "high", "deep"] as const
export type EffortLevelValue = (typeof EffortLevelValue)[number]

export function effortFromMetadata(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.effort
  return EffortLevelValue.includes(value as EffortLevelValue) ? (value as EffortLevelValue) : undefined
}

export function numericMetadata(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function hasAny(value: string, terms: string[]) {
  return terms.some((item) => value.includes(item))
}

export function isBroadAgentTask(goal: string) {
  const normalized = goal.toLowerCase()
  const broadModifiers = [
    "deep dive",
    "dive deeper",
    "thorough",
    "comprehensive",
    "full",
    "entire",
    "whole",
    "all files",
  ]
  const projectTargets = [
    "project",
    "repo",
    "repository",
    "codebase",
    "workspace",
    "source tree",
    "src directory",
    "package structure",
  ]
  const technicalTargets = [
    "architecture",
    "technical detail",
    "technical details",
    "technological detail",
    "technological details",
    "key technology",
    "key technological",
    "algorithms",
    "internals",
    "structure",
  ]
  const explicitProjectPhrases = [
    "full project",
    "entire project",
    "whole project",
    "codebase overview",
    "project overview",
    "project architecture",
    "project structure",
    "repository structure",
    "how this project works",
    "how the project works",
  ]
  const chineseBroadModifiers = ["深入", "深度", "完整", "全面", "彻底", "全部"]
  const chineseProjectTargets = ["项目", "仓库", "代码库", "工作区", "源码"]
  const chineseTechnicalTargets = ["架构", "算法", "技术细节", "技术详情", "核心技术", "项目结构"]
  if (hasAny(normalized, explicitProjectPhrases)) return true
  if (hasAny(normalized, broadModifiers) && (hasAny(normalized, projectTargets) || hasAny(normalized, technicalTargets)))
    return true
  if (hasAny(normalized, projectTargets) && hasAny(normalized, technicalTargets)) return true
  return (
    hasAny(goal, chineseBroadModifiers) &&
    (hasAny(goal, chineseProjectTargets) || hasAny(goal, chineseTechnicalTargets))
  )
}
