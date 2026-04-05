# 04 - 多 Provider 管理

## Provider 注册

`src/agent/provider.ts` 用 `createProviderRegistry` 将多个 provider 统一注册，通过 `provider:model-id` 格式的字符串寻址模型：

```typescript
import { createProviderRegistry } from 'ai'

const registry = createProviderRegistry({
  anthropic: createAnthropic({ apiKey: '...' }),
  openai: createOpenAI({ apiKey: '...' }),
  ollama: createOllama({ baseURL: '...' }),
  openrouter: { ... },
})

// 获取模型
const model = registry.languageModel('anthropic:claude-sonnet-4-20250514')
```

Provider 按需注册：有 API Key 才注册对应 provider，Ollama 始终注册（本地无需 key）。

## 支持的 4 个 Provider

| Provider | 包 | 说明 |
|----------|----|------|
| anthropic | @ai-sdk/anthropic | Claude 系列 |
| openai | @ai-sdk/openai | GPT 系列 |
| ollama | ollama-ai-provider-v2 | 本地开源模型 |
| openrouter | @ai-sdk/openai（自定义 baseURL） | 多模型网关 |

## OpenRouter 特殊处理

`@ai-sdk/openai` v3 默认使用 OpenAI 的 Responses API（`POST /responses`）。OpenRouter 仅支持 Chat Completions API（`POST /chat/completions`），带工具调用的请求会报 `Invalid Responses API request`。

解决方式是将 `languageModel` 覆盖为 `.chat`（Chat Completions 端点）：

```typescript
// src/agent/provider.ts
const openrouterProvider = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: aiConfig.openrouterApiKey,
})
providers.openrouter = {
  ...openrouterProvider,
  languageModel: openrouterProvider.chat,  // 覆盖默认的 Responses API
}
```

其他 OpenAI 兼容的第三方 API（如 vLLM、LiteLLM）同样需要此处理。

## 运行时切换模型

REPL 中用 `/model provider:model-id` 临时切换（`src/agent/index.ts:88-104`）：

```typescript
if (input.startsWith('/model ')) {
  const newModelId = input.slice(7).trim()
  const [provider, ...rest] = newModelId.split(':')
  config.ai.provider = provider as typeof config.ai.provider
  config.ai.model = rest.join(':')
  model = getModel(config.ai)
}
```

切换只影响当前会话，不修改配置文件。
