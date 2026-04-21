import { Token } from "@/util"

export interface PromptEstimate {
  system: number // 系统提示
  tools: number // 工具定义
  history: number // 历史消息
  input: number // 当前输入
  output: number // 预估输出
  total: number // 总计
  available: number // 可用空间
}

export function estimatePromptTokens(
  input: string,
  modelContextLimit: number,
  systemPrompt: string,
  toolDefinitions: string,
  historyTokens: number,
): PromptEstimate {
  const systemTokens = Token.estimate(systemPrompt)
  const toolTokens = Token.estimate(toolDefinitions)
  const inputTokens = Token.estimate(input)
  const outputTokens = Math.round(inputTokens * 1.5) // 保留预估

  const total = systemTokens + toolTokens + historyTokens + inputTokens + outputTokens
  const available = Math.max(0, modelContextLimit - total)

  return {
    system: systemTokens,
    tools: toolTokens,
    history: historyTokens,
    input: inputTokens,
    output: outputTokens,
    total,
    available,
  }
}
