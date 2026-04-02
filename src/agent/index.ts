import { stdin, stdout } from 'node:process'
import * as readline from 'node:readline/promises'
import * as p from '@clack/prompts'
import type { LanguageModel, ModelMessage } from 'ai'
import { generateText, stepCountIs, type ToolSet } from 'ai'
import { getModel } from '@/agent/provider.ts'
import { buildSystemPrompt } from '@/agent/system-prompt.ts'
import { createAgentTools } from '@/agent/tools/index.ts'
import { getCurrentEnv, loadConfig } from '@/config/index.ts'
import logger from '@/utils/logger.ts'

/**
 * 单轮 Agent 对话：调用 generateText，工具自动执行（确认逻辑在工具 execute 内部），输出文本结果。
 * 不使用 AI SDK 的 needsApproval 流程，避免 approval 消息与 Chat Completions API 不兼容。
 */
export const runAgentLoop = async (
  model: LanguageModel,
  system: string,
  tools: ToolSet,
  messages: ModelMessage[],
): Promise<void> => {
  const result = await generateText({
    model,
    system,
    tools,
    messages,
    stopWhen: stepCountIs(10),
  })

  // 只将最终文本加入历史（不保留中间的 tool_call/tool_result 消息，
  // 避免 Chat Completions API 在后续请求中拒绝这些消息格式）
  if (result.text) {
    messages.push({ role: 'assistant', content: result.text })
  }

  // 输出文本结果
  const textParts = result.content.filter((part) => part.type === 'text')
  for (const part of textParts) {
    console.log(part.text)
  }
}

export const startAgent = async (envOverride?: string): Promise<void> => {
  // 1. 加载配置
  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig(envOverride)
  } catch (err) {
    logger.error((err as Error).message)
    process.exit(1)
  }
  if (!config.ai) {
    logger.error('请先运行 ycli env init 配置 AI 助手')
    process.exit(1)
  }

  // 2. 初始化
  const env = envOverride ?? getCurrentEnv()
  let model = getModel(config.ai)
  const system = buildSystemPrompt(config, env)
  const tools = createAgentTools(envOverride)
  let messages: ModelMessage[] = []

  // 3. 启动 REPL
  p.intro('ycli Agent 已启动')
  logger.info(`模型: ${config.ai.provider}:${config.ai.model}`)

  const rl = readline.createInterface({ input: stdin, output: stdout })

  // 4. 循环
  while (true) {
    const input = await rl.question('> ')
    if (!input.trim()) continue

    // REPL 内置命令
    if (input === '/quit' || input === '/exit') {
      p.outro('再见')
      rl.close()
      break
    }

    if (input === '/clear') {
      messages = []
      logger.success('对话已清空')
      continue
    }

    if (input.startsWith('/model ')) {
      const newModelId = input.slice(7).trim()
      const [provider, ...rest] = newModelId.split(':')
      const modelName = rest.join(':')
      if (!provider || !modelName) {
        logger.error('格式: /model provider:model-id')
        continue
      }
      try {
        config.ai.provider = provider as typeof config.ai.provider
        config.ai.model = modelName
        model = getModel(config.ai)
        logger.success(`模型已切换为 ${newModelId}`)
      } catch (err) {
        logger.error(`切换失败: ${err instanceof Error ? err.message : err}`)
      }
      continue
    }

    // 正常对话
    messages.push({ role: 'user', content: input })
    // 暂停 readline 让 @clack/prompts 的 confirm 能正常读取 stdin
    rl.pause()
    try {
      await runAgentLoop(model, system, tools, messages)
    } catch (err) {
      logger.error(`Agent 错误: ${err instanceof Error ? err.message : err}`)
    }
    rl.resume()
  }
}
