# 子任务 2：Provider 层（含 OpenRouter 支持）

## 交付物

- `src/config/env.ts`：ConfigSchema 新增 `openrouter` provider + `openrouterApiKey`
- `src/commands/env.ts`：env init 新增 OpenRouter 选项 + env show 脱敏 + 新增 env set 命令
- `src/agent/provider.ts`：四 provider 注册（Anthropic/OpenAI/Ollama/OpenRouter）+ getModel
- 测试通过（env.test.ts 新增用例 + provider.test.ts）

## TODO

- [ ] 修改 `src/config/env.ts`（ConfigSchema 新增 openrouter）
- [ ] 修改 `src/commands/env.ts`（env init + env show + 新增 env set）
- [ ] 新建 `src/agent/provider.ts`（createRegistry + getModel）
- [ ] 更新测试 `src/config/__tests__/env.test.ts`
- [ ] 新建测试 `src/agent/__tests__/provider.test.ts`
- [ ] lint + typecheck + test 验证

## 实施规格

### 1. ConfigSchema 变更（`src/config/env.ts`）

`ai` 段新增 `'openrouter'` 枚举值和 `openrouterApiKey` 字段：

```typescript
ai: z.object({
  provider: z.enum(['anthropic', 'openai', 'ollama', 'openrouter']).default('anthropic'),
  model: z.string().default('claude-sonnet-4-20250514'),
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  openrouterApiKey: z.string().optional(),
}).optional()
```

### 2. env init 交互变更（`src/commands/env.ts`）

#### 提供商选择新增 OpenRouter

在 `p.select` 的 options 中添加：
```typescript
{ value: 'openrouter', label: 'OpenRouter (多模型网关)' }
```

#### OpenRouter 配置交互

选择 OpenRouter 后的交互流程（与 Anthropic/OpenAI 对称）：
```typescript
} else if (provider === 'openrouter') {
  const apiKey = await p.password({ message: 'OpenRouter API Key' })
  // isCancel 检查...
  const model = await p.text({
    message: '模型 ID',
    defaultValue: 'anthropic/claude-sonnet-4',  // OpenRouter 格式：provider/model
  })
  // isCancel 检查...
  ai = { provider: 'openrouter', model, openrouterApiKey: apiKey }
}
```

OpenRouter 模型 ID 格式为 `provider/model-name`，如：
- `anthropic/claude-sonnet-4`
- `openai/gpt-4o`
- `meta-llama/llama-3-70b-instruct`

#### env show 脱敏

在 `showCommand` 的 safeConfig 构建中添加：
```typescript
openrouterApiKey: config.ai.openrouterApiKey ? '******' : undefined,
```

### 3. 新增 `ycli env set` 命令（`src/commands/env.ts`）

支持通过命令行直接修改配置字段，无需重新走 init 交互流程。

#### 用法

```bash
ycli env set <key> <value>         # 修改当前环境
ycli env set <key> <value> --env prd  # 修改指定环境
```

#### 支持的 key（点号分隔的路径）

```
ai.provider        — LLM 提供商（anthropic/openai/ollama/openrouter）
ai.model           — 模型 ID
ai.anthropicApiKey  — Anthropic API Key
ai.openaiApiKey     — OpenAI API Key
ai.openrouterApiKey — OpenRouter API Key
ai.ollamaBaseUrl    — Ollama 服务地址
mysql.host          — MySQL 主机
mysql.port          — MySQL 端口
mysql.user          — MySQL 用户名
mysql.password      — MySQL 密码
mysql.database      — MySQL 数据库名
mongo.uri           — MongoDB URI
http.baseUrl        — HTTP Base URL
```

#### 实现逻辑

```typescript
const setCommand = defineCommand({
  meta: { name: 'set', description: '修改配置字段' },
  args: {
    key: { type: 'positional', description: '配置路径（如 ai.model）', required: true },
    value: { type: 'positional', description: '新值', required: true },
    env: { type: 'string', description: '指定环境（默认当前环境）' },
  },
  run({ args }) {
    const config = loadConfig(args.env)
    // 按 '.' 拆分 key，设置嵌套字段值
    // 对 mysql.port 做 Number() 转换
    // 通过 ConfigSchema.parse() 校验修改后的配置
    // saveConfig(env, config)
  },
})
```

**关键点**：
- 修改后必须通过 `ConfigSchema.parse()` 校验，拒绝无效值（如 `ai.provider invalid`）
- `mysql.port` 需要 `Number()` 转换
- 不存在的 key 直接报错，不创建任意路径

#### 典型使用场景

```bash
ycli env set ai.model anthropic/claude-sonnet-4    # 切换模型
ycli env set ai.provider openrouter                 # 切换提供商
ycli env set ai.openrouterApiKey or-xxx             # 更新 API Key
```

### 4. Provider 层（`src/agent/provider.ts`）

#### 依赖导入

```typescript
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOllama } from 'ollama-ai-provider-v2'
import { createProviderRegistry, type LanguageModel } from 'ai'
import type { Config } from '@/config/env.ts'
```

注意：OpenRouter 使用 `createOpenAI` + 自定义 baseURL，**不需要额外安装依赖**。

#### `createRegistry(aiConfig)`

根据配置中的 API Key 条件注册四个 provider：

```typescript
export const createRegistry = (aiConfig: NonNullable<Config['ai']>) => {
  const providers: Record<string, Provider> = {}

  // Anthropic：有 apiKey 才注册
  if (aiConfig.anthropicApiKey) {
    providers.anthropic = createAnthropic({ apiKey: aiConfig.anthropicApiKey })
  }

  // OpenAI：有 apiKey 才注册
  if (aiConfig.openaiApiKey) {
    providers.openai = createOpenAI({ apiKey: aiConfig.openaiApiKey })
  }

  // OpenRouter：有 apiKey 才注册，使用 OpenAI 兼容接口
  if (aiConfig.openrouterApiKey) {
    providers.openrouter = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: aiConfig.openrouterApiKey,
    })
  }

  // Ollama：始终注册（本地模型无需 apiKey）
  providers.ollama = createOllama({ baseURL: aiConfig.ollamaBaseUrl })

  return createProviderRegistry(providers)
}
```

#### `getModel(aiConfig)`

基于配置获取 LanguageModel 实例：

```typescript
export const getModel = (aiConfig: NonNullable<Config['ai']>): LanguageModel => {
  const registry = createRegistry(aiConfig)
  const modelId = `${aiConfig.provider}:${aiConfig.model}`

  try {
    return registry.languageModel(modelId)
  } catch {
    throw new Error(
      `无法加载模型 ${modelId}。请检查：\n` +
      `  - provider "${aiConfig.provider}" 是否已配置 API Key\n` +
      `  - 模型 ID "${aiConfig.model}" 是否正确\n` +
      `运行 ycli env init 重新配置`
    )
  }
}
```

#### 设计决策

- **无状态设计**：`getModel()` 每次调用创建新 registry。registry 创建成本极低（只是注册 provider 引用），无需缓存。返回的 `LanguageModel` 被 REPL 循环持有复用，`getModel()` 只在启动和切换模型时调用。
- **OpenRouter 复用 `createOpenAI`**：OpenRouter API 完全兼容 OpenAI 接口，只需设置 `baseURL`，无需额外依赖。
- **providers 类型**：使用 `Record<string, Provider>`，实际写代码时确认 `Provider` 从 `ai` 包的具体导入路径。

### 4. 测试规格

#### `src/config/__tests__/env.test.ts` 新增用例

```
it('解析含 openrouter ai 配置')
  - 传入 { provider: 'openrouter', model: 'anthropic/claude-sonnet-4', openrouterApiKey: 'or-xxx' }
  - 验证 result.ai?.provider === 'openrouter'
  - 验证 result.ai?.openrouterApiKey === 'or-xxx'
```

#### `src/config/__tests__/index.test.ts` 新增 env set 相关用例

```
describe('env set (通过 loadConfig + saveConfig 验证)', () => {
  it('修改嵌套字段后重新加载一致')
    - saveConfig 一份配置
    - loadConfig → 修改 config.ai.model → saveConfig → loadConfig
    - 验证 model 值已变更，其他字段不变

  it('修改后通过 ConfigSchema 校验')
    - 修改 ai.provider 为合法值 → 校验通过
    - 修改 ai.provider 为非法值 → 校验抛错
})
```

#### `src/agent/__tests__/provider.test.ts`

测试策略：不 mock AI SDK 底层，直接传入不同配置验证 registry 行为。

```
describe('createRegistry', () => {
  it('有 anthropicApiKey 时可访问 anthropic 模型')
    - 传入 { anthropicApiKey: 'sk-test', ... }
    - registry.languageModel('anthropic:claude-sonnet-4-20250514') 不抛错

  it('有 openaiApiKey 时可访问 openai 模型')
    - 传入 { openaiApiKey: 'sk-test', ... }
    - registry.languageModel('openai:gpt-4o') 不抛错

  it('有 openrouterApiKey 时可访问 openrouter 模型')
    - 传入 { openrouterApiKey: 'or-test', ... }
    - registry.languageModel('openrouter:anthropic/claude-sonnet-4') 不抛错

  it('ollama 始终可访问')
    - 传入无任何 apiKey 的最小配置
    - registry.languageModel('ollama:llama3') 不抛错

  it('未注册的 provider 抛出错误')
    - 传入无 anthropicApiKey 的配置
    - registry.languageModel('anthropic:xxx') 抛错
})

describe('getModel', () => {
  it('正确解析 provider:model 格式')
    - 传入 { provider: 'ollama', model: 'llama3', ... }
    - getModel() 返回 LanguageModel 实例

  it('provider 未注册时抛出友好错误')
    - 传入 { provider: 'anthropic', model: 'xxx' } 但无 anthropicApiKey
    - 抛出包含 "无法加载模型" 的错误
})
```

#### Mock 注意

- `createAnthropic({ apiKey })` 等工厂函数返回 provider 对象，注册到 registry 后通过 `registry.languageModel()` 获取模型引用——这一步不涉及网络请求。
- 若工厂函数在创建时即校验 API Key 格式导致报错，则改用 `vi.mock` 模拟工厂函数返回。

## 错误追踪

| 错误描述 | 尝试次数 | 解决方案 |
|----------|----------|----------|
| （暂无） | | |
