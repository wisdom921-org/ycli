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

const runAgentLoop = async (
  model: LanguageModel,
  system: string,
  tools: ToolSet,
  messages: ModelMessage[],
): Promise<void> => {
  while (true) {
    const result = await generateText({
      model,
      system,
      tools,
      messages,
      stopWhen: stepCountIs(10),
    })

    // 将 LLM 响应加入历史
    messages.push(...result.response.messages)

    // 检查是否有 approval 请求
    const approvalRequests = result.content.filter((part) => part.type === 'tool-approval-request')

    if (approvalRequests.length === 0) {
      // 无 approval 请求 → 输出文本结果并结束
      const textParts = result.content.filter((part) => part.type === 'text')
      for (const part of textParts) {
        console.log(part.text)
      }
      break
    }

    // 处理 approval 请求
    const approvals: Array<{
      type: 'tool-approval-response'
      approvalId: string
      approved: boolean
      reason: string
    }> = []

    for (const req of approvalRequests) {
      if (req.type !== 'tool-approval-request') continue

      logger.info(`工具调用: ${req.toolCall.toolName}`)
      console.log(JSON.stringify(req.toolCall.input, null, 2))

      let confirmed = await p.confirm({
        message: '是否执行此操作？',
      })

      if (p.isCancel(confirmed)) {
        confirmed = false
      }

      approvals.push({
        type: 'tool-approval-response',
        approvalId: req.approvalId,
        approved: !!confirmed,
        reason: confirmed ? '用户已确认' : '用户已拒绝',
      })
    }

    // 将 approval 响应加入消息，继续循环
    messages.push({ role: 'tool', content: approvals })
  }
}

export const startAgent = async (envOverride?: string): Promise<void> => {
  // 1. 加载配置
  const config = loadConfig(envOverride)
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
    try {
      await runAgentLoop(model, system, tools, messages)
    } catch (err) {
      logger.error(`Agent 错误: ${err instanceof Error ? err.message : err}`)
    }
  }
}
