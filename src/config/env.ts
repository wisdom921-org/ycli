import { z } from 'zod'

// 配置文件 Schema
export const ConfigSchema = z.object({
  // MySQL
  mysql: z.object({
    host: z.string(),
    port: z.number().default(3306),
    user: z.string(),
    password: z.string(),
    database: z.string(),
  }),

  // MongoDB
  mongo: z.object({
    uri: z.string(),
  }),

  // HTTP（可选）
  http: z
    .object({
      baseUrl: z.string().url(),
    })
    .optional(),

  // AI 助手配置（可选）
  ai: z
    .object({
      // LLM 提供商
      provider: z.enum(['anthropic', 'openai', 'ollama', 'openrouter']).default('anthropic'),
      // 模型 ID
      model: z.string().default('claude-sonnet-4-20250514'),
      // Anthropic API Key
      anthropicApiKey: z.string().optional(),
      // OpenAI API Key
      openaiApiKey: z.string().optional(),
      // Ollama 服务地址
      ollamaBaseUrl: z.string().default('http://localhost:11434'),
      // OpenRouter API Key
      openrouterApiKey: z.string().optional(),
    })
    .optional(),
})

export type Config = z.infer<typeof ConfigSchema>
