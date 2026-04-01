import { describe, expect, it } from 'vitest'
import { createRegistry, getModel } from '../provider'

// 最小 AI 配置（仅 Ollama，无需 apiKey）
const minimalConfig = {
  provider: 'ollama' as const,
  model: 'llama3',
  ollamaBaseUrl: 'http://localhost:11434',
}

describe('createRegistry', () => {
  it('有 anthropicApiKey 时可访问 anthropic 模型', () => {
    const registry = createRegistry({
      ...minimalConfig,
      anthropicApiKey: 'sk-test',
    })
    const model = registry.languageModel('anthropic:claude-sonnet-4-20250514')
    expect(model).toBeDefined()
  })

  it('有 openaiApiKey 时可访问 openai 模型', () => {
    const registry = createRegistry({
      ...minimalConfig,
      openaiApiKey: 'sk-test',
    })
    const model = registry.languageModel('openai:gpt-4o')
    expect(model).toBeDefined()
  })

  it('有 openrouterApiKey 时可访问 openrouter 模型', () => {
    const registry = createRegistry({
      ...minimalConfig,
      openrouterApiKey: 'or-test',
    })
    const model = registry.languageModel('openrouter:anthropic/claude-sonnet-4')
    expect(model).toBeDefined()
  })

  it('ollama 始终可访问', () => {
    const registry = createRegistry(minimalConfig)
    const model = registry.languageModel('ollama:llama3')
    expect(model).toBeDefined()
  })

  it('未注册的 provider 抛出错误', () => {
    const registry = createRegistry(minimalConfig)
    expect(() => registry.languageModel('anthropic:claude-sonnet-4-20250514')).toThrow()
  })
})

describe('getModel', () => {
  it('正确解析 provider:model 格式', () => {
    const model = getModel(minimalConfig)
    expect(model).toBeDefined()
  })

  it('provider 未注册时抛出友好错误', () => {
    expect(() =>
      getModel({
        ...minimalConfig,
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      }),
    ).toThrow(/无法加载模型/)
  })
})
