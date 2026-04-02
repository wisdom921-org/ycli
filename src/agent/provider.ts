import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createProviderRegistry, type LanguageModel } from 'ai'
import { createOllama } from 'ollama-ai-provider-v2'
import type { Config } from '@/config/env.ts'

type AiConfig = NonNullable<Config['ai']>

/**
 * 根据配置中的 API Key 条件注册 providers
 * - Anthropic/OpenAI/OpenRouter：有对应 apiKey 才注册
 * - Ollama：始终注册（本地模型无需 apiKey）
 */
export const createRegistry = (aiConfig: AiConfig) => {
  // biome-ignore lint/suspicious/noExplicitAny: provider 类型由各 SDK 各自定义，统一用 Record 收集
  const providers: Record<string, any> = {}

  if (aiConfig.anthropicApiKey) {
    providers.anthropic = createAnthropic({ apiKey: aiConfig.anthropicApiKey })
  }

  if (aiConfig.openaiApiKey) {
    providers.openai = createOpenAI({ apiKey: aiConfig.openaiApiKey })
  }

  if (aiConfig.openrouterApiKey) {
    // @ai-sdk/openai v3 默认走 Responses API（POST /responses），
    // OpenRouter 仅支持 Chat Completions API，需将 languageModel 指向 chat
    const openrouterProvider = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: aiConfig.openrouterApiKey,
    })
    providers.openrouter = {
      ...openrouterProvider,
      languageModel: openrouterProvider.chat,
    }
  }

  providers.ollama = createOllama({ baseURL: aiConfig.ollamaBaseUrl })

  return createProviderRegistry(providers)
}

/** 基于配置获取 LanguageModel 实例 */
export const getModel = (aiConfig: AiConfig): LanguageModel => {
  const registry = createRegistry(aiConfig)
  const modelId = `${aiConfig.provider}:${aiConfig.model}` as `${string}:${string}`

  try {
    return registry.languageModel(modelId)
  } catch {
    throw new Error(
      `无法加载模型 ${modelId}。请检查：\n` +
        `  - provider "${aiConfig.provider}" 是否已配置 API Key\n` +
        `  - 模型 ID "${aiConfig.model}" 是否正确\n` +
        `运行 ycli env init 或 ycli env set 重新配置`,
    )
  }
}
