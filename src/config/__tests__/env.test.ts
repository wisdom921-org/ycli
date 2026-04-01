import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../env'

const baseConfig = {
  mysql: { host: 'localhost', port: 3306, user: 'root', password: 'pass', database: 'test' },
  mongo: { uri: 'mongodb://localhost:27017/test' },
}

describe('ConfigSchema', () => {
  it('解析不含 ai 段的配置（向后兼容）', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.ai).toBeUndefined()
  })

  it('解析含 anthropic ai 配置', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      ai: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', anthropicApiKey: 'sk-xxx' },
    })
    expect(result.ai?.provider).toBe('anthropic')
    expect(result.ai?.anthropicApiKey).toBe('sk-xxx')
  })

  it('解析含 openai ai 配置', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      ai: { provider: 'openai', model: 'gpt-4o', openaiApiKey: 'sk-yyy' },
    })
    expect(result.ai?.provider).toBe('openai')
  })

  it('解析含 ollama ai 配置', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      ai: { provider: 'ollama', model: 'llama3', ollamaBaseUrl: 'http://localhost:11434' },
    })
    expect(result.ai?.provider).toBe('ollama')
    expect(result.ai?.ollamaBaseUrl).toBe('http://localhost:11434')
  })

  it('ai 段使用默认值', () => {
    const result = ConfigSchema.parse({ ...baseConfig, ai: {} })
    expect(result.ai?.provider).toBe('anthropic')
    expect(result.ai?.model).toBe('claude-sonnet-4-20250514')
    expect(result.ai?.ollamaBaseUrl).toBe('http://localhost:11434')
  })

  it('解析含 openrouter ai 配置', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      ai: {
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        openrouterApiKey: 'or-xxx',
      },
    })
    expect(result.ai?.provider).toBe('openrouter')
    expect(result.ai?.openrouterApiKey).toBe('or-xxx')
  })

  it('拒绝无效 provider', () => {
    expect(() => ConfigSchema.parse({ ...baseConfig, ai: { provider: 'invalid' } })).toThrow()
  })
})
