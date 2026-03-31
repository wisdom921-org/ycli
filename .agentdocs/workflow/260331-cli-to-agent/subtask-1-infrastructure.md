# 子任务 1：基础设施（依赖 + 配置 + env init）

## 交付物

- AI SDK 及测试依赖安装完成
- Vitest 配置就绪
- `ycli env init` 支持 AI 配置交互
- config 文件正确保存/加载 ai 段
- 配置层单元测试通过

## TODO

- [x] 1.1 安装依赖
- [x] 1.2 新建 `vitest.config.ts`
- [x] 1.3 更新 `package.json` scripts
- [x] 1.4 修改 `src/config/env.ts`
- [x] 1.5 修改 `src/commands/env.ts`
- [x] 1.6 新建测试文件
- [x] 1.7 验证

## 实施规格

### 1.1 安装依赖

```bash
bun add ai @ai-sdk/anthropic @ai-sdk/openai ollama-ai-provider-v2
bun add -D vitest
```

安装后确认 `ai` 版本 >= 5.0（`needsApproval` 从 v5 开始支持），若不对则 `bun add ai@^5.0.0`。

### 1.2 新建 `vitest.config.ts`

项目根目录新建：

```typescript
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
```

### 1.3 更新 `package.json` scripts

在现有 scripts 中增加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

### 1.4 修改 `src/config/env.ts`

**文件路径**：`src/config/env.ts`（当前 27 行）

**改动**：在 `http` 字段之后、ConfigSchema 闭合 `)` 之前新增 `ai` 段：

```typescript
// AI 助手配置
ai: z.object({
  // LLM 提供商
  provider: z.enum(['anthropic', 'openai', 'ollama']).default('anthropic'),
  // 模型 ID
  model: z.string().default('claude-sonnet-4-20250514'),
  // Anthropic API Key
  anthropicApiKey: z.string().optional(),
  // OpenAI API Key
  openaiApiKey: z.string().optional(),
  // Ollama 服务地址
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
}).optional(),
```

**要点**：
- 外层 `.optional()` 确保向后兼容，已有配置文件无 ai 段不会解析失败
- API Key 各自 optional，只需配置选中 provider 对应的 key
- `Config` 类型由 `z.infer` 自动推导，无需手动修改

### 1.5 修改 `src/commands/env.ts`

**文件路径**：`src/commands/env.ts`（当前 211 行）

#### 1.5.1 initCommand — 增加 AI 配置交互

**插入位置**：在 HTTP 配置逻辑之后（约 L99）、`ConfigSchema.parse` 调用之前（约 L102）。

**插入代码**：

```typescript
// AI 配置（可选）
const configureAi = await p.confirm({
  message: '是否配置 AI 助手?',
  initialValue: false,
})

let ai: {
  provider: string
  model: string
  anthropicApiKey?: string
  openaiApiKey?: string
  ollamaBaseUrl?: string
} | undefined

if (configureAi && !p.isCancel(configureAi)) {
  p.log.step('AI 助手配置')

  const provider = await p.select({
    message: '选择 LLM 提供商',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude)' },
      { value: 'openai', label: 'OpenAI (GPT)' },
      { value: 'ollama', label: 'Ollama (本地模型)' },
    ],
  })
  if (p.isCancel(provider)) { p.cancel('已取消'); process.exit(0) }

  if (provider === 'anthropic') {
    const apiKey = await p.password({ message: 'Anthropic API Key' })
    if (p.isCancel(apiKey)) { p.cancel('已取消'); process.exit(0) }
    const model = await p.text({
      message: '模型 ID',
      defaultValue: 'claude-sonnet-4-20250514',
    })
    if (p.isCancel(model)) { p.cancel('已取消'); process.exit(0) }
    ai = { provider: 'anthropic', model, anthropicApiKey: apiKey }

  } else if (provider === 'openai') {
    const apiKey = await p.password({ message: 'OpenAI API Key' })
    if (p.isCancel(apiKey)) { p.cancel('已取消'); process.exit(0) }
    const model = await p.text({
      message: '模型 ID',
      defaultValue: 'gpt-4o',
    })
    if (p.isCancel(model)) { p.cancel('已取消'); process.exit(0) }
    ai = { provider: 'openai', model, openaiApiKey: apiKey }

  } else {
    const ollamaBaseUrl = await p.text({
      message: 'Ollama 服务地址',
      defaultValue: 'http://localhost:11434',
    })
    if (p.isCancel(ollamaBaseUrl)) { p.cancel('已取消'); process.exit(0) }
    const model = await p.text({
      message: '模型 ID',
      defaultValue: 'llama3',
    })
    if (p.isCancel(model)) { p.cancel('已取消'); process.exit(0) }
    ai = { provider: 'ollama', model, ollamaBaseUrl }
  }
}
```

#### 1.5.2 initCommand — 修改 ConfigSchema.parse 调用

**当前**（L102-106）：
```typescript
const config = ConfigSchema.parse({
  mysql: { ...mysql, port: Number(mysql.port) },
  mongo: { uri: mongoUri },
  http,
})
```

**改为**：
```typescript
const config = ConfigSchema.parse({
  mysql: { ...mysql, port: Number(mysql.port) },
  mongo: { uri: mongoUri },
  http,
  ai,
})
```

#### 1.5.3 showCommand — 脱敏展示 AI 配置

**位置**：showCommand 的 `safeConfig` 对象中（约 L180-189），在 `http: config.http,` 之后追加：

```typescript
ai: config.ai
  ? {
      ...config.ai,
      anthropicApiKey: config.ai.anthropicApiKey ? '******' : undefined,
      openaiApiKey: config.ai.openaiApiKey ? '******' : undefined,
    }
  : undefined,
```

### 1.6 测试

#### 1.6.1 新建 `src/config/__tests__/env.test.ts`

测试 ConfigSchema 解析行为：

```typescript
import { describe, it, expect } from 'vitest'
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

  it('拒绝无效 provider', () => {
    expect(() =>
      ConfigSchema.parse({ ...baseConfig, ai: { provider: 'invalid' } })
    ).toThrow()
  })
})
```

#### 1.6.2 新建 `src/config/__tests__/index.test.ts`

测试配置管理（保存/加载/列举）。

**mock 策略**：`vi.mock('@/config/paths.ts')` 将 `CONFIG_DIR` 和 `getConfigPath` 指向 `/tmp/ycli-test-{random}/`，每个测试前 `mkdirSync`、测试后 `rmSync` 清理。

**测试点**：
- `saveConfig` + `loadConfig` 往返一致（含 ai 段）
- `loadConfig` 无 ai 段时返回 `undefined`（向后兼容）
- `listEnvs` 正确列出已保存环境
- `envExists` 对存在/不存在的环境返回正确布尔值
- `loadConfig` 缺失环境时抛出明确错误

### 1.7 验证步骤

1. `bun run lint` — 无错误
2. `bun run typecheck` — 无错误
3. `bun run test` — 所有测试通过
4. 手动 `bun run src/index.ts env init` — AI 配置交互正常
5. 检查 `~/.ycli/config.{env}.json` 含 ai 字段
6. `bun run src/index.ts env show` — AI 配置脱敏展示正确

## 错误追踪

| 错误描述 | 尝试次数 | 解决方案 |
|----------|----------|----------|
| `ai` 包安装版本为 6.0.142（>= v5，满足 needsApproval 需求） | 1 | 无需额外处理 |
| biome lint 报 import 顺序错误（vitest.config.ts）及 env.test.ts 格式问题 | 1 | 调整 import 顺序、将多行 expect 合并为单行 |
| index.test.ts 中同 env 名（'dev'）被模块级缓存命中导致含 ai 段测试失败 | 1 | 每个测试使用不同 env 名（'env-no-ai'、'env-with-ai' 等）绕过缓存 |
