# 子任务 4：Agent REPL

## 交付物

- `src/agent/system-prompt.ts`：基于环境配置动态构建 system prompt
- `src/agent/index.ts`：REPL 主循环，含 approval 确认流程
- `src/index.ts` 入口改造：无子命令时启动 Agent REPL
- 删除 `src/commands/example.ts`
- 端到端可用，`ycli` 启动交互式 Agent
- 测试 + build 通过

## TODO

- [ ] 新建 `src/agent/system-prompt.ts`
- [ ] 新建 `src/agent/index.ts`
- [ ] 修改 `src/index.ts`
- [ ] 删除 `src/commands/example.ts`
- [ ] 新建测试 `src/agent/__tests__/repl.test.ts`
- [ ] lint + typecheck + test + build 验证
- [ ] 更新 `.agentdocs/architecture.md`

## 实施规格

### 文件：`src/agent/system-prompt.ts`

#### 依赖

```typescript
import type { Config } from '@/config/env.ts'
```

#### 导出

```typescript
export const buildSystemPrompt = (config: Config, env?: string | null): string
```

#### System Prompt 模板

```
你是 ycli，一个个人 AI 助手，运行在用户的终端中。

## 能力
你可以通过工具执行以下操作：
- **MySQL 数据库**：查询（mysqlQuery）和写入（mysqlExecute，需确认）
- **MongoDB 数据库**：查询（mongoQuery）和写入（mongoExecute，需确认）
- **HTTP 请求**：发起请求（httpRequest，非 GET 需确认）

## 当前环境
- 环境名称：{env ?? '未知'}
- MySQL：{config.mysql.host}:{config.mysql.port}/{config.mysql.database}
- MongoDB：{config.mongo.uri（脱敏）}
{config.http?.baseUrl ? `- HTTP Base URL：${config.http.baseUrl}` : ''}

## 规则
1. 执行写操作前，先用对应的读工具确认数据状态
2. SQL 查询优先使用 LIMIT 限制返回行数，避免大量数据输出
3. 返回数据时使用简洁的表格或列表格式
4. 遇到错误时分析原因并给出修复建议
5. 不要编造不存在的表名或集合名——不确定时先查询 schema
```

**动态部分**：
- 环境名称从 `env` 参数获取
- 数据库连接信息从 `config` 提取，MongoDB URI 脱敏（隐藏密码）
- HTTP baseUrl 仅在配置存在时展示

---

### 文件：`src/agent/index.ts`

#### 依赖

```typescript
import * as readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { generateText, stepCountIs, type ModelMessage, type ToolApprovalResponse } from 'ai'
import * as p from '@clack/prompts'
import { loadConfig, getCurrentEnv } from '@/config/index.ts'
import { getModel } from '@/agent/provider.ts'
import { buildSystemPrompt } from '@/agent/system-prompt.ts'
import { createAgentTools } from '@/agent/tools/index.ts'
import logger from '@/utils/logger.ts'
```

#### 导出

```typescript
export const startAgent = async (envOverride?: string): Promise<void>
```

#### REPL 主循环流程

```
startAgent(envOverride?):
  1. 加载配置
     config = loadConfig(envOverride)
     if (!config.ai) → 打印错误"请先运行 ycli env init 配置 AI 助手" → process.exit(1)

  2. 初始化
     env = envOverride ?? getCurrentEnv()
     model = getModel(config.ai)
     system = buildSystemPrompt(config, env)
     tools = createAgentTools(envOverride)
     messages: ModelMessage[] = []

  3. 启动 REPL
     p.intro('ycli Agent 已启动')
     打印当前模型信息
     rl = readline.createInterface({ input: stdin, output: stdout })

  4. 循环
     while (true):
       input = await rl.question('> ')
       if (!input.trim()) → continue

       // REPL 内置命令
       if (input === '/quit' || input === '/exit'):
         p.outro('再见')
         rl.close()
         break

       if (input === '/clear'):
         messages = []
         logger.success('对话已清空')
         continue

       if (input.startsWith('/model ')):
         newModelId = input.slice(7).trim()  // 格式: "provider:model"
         config.ai.provider = newModelId.split(':')[0]
         config.ai.model = newModelId.split(':').slice(1).join(':')
         model = getModel(config.ai)
         logger.success(`模型已切换为 ${newModelId}`)
         continue

       // 正常对话
       messages.push({ role: 'user', content: input })
       await runAgentLoop(model, system, tools, messages)
```

#### Agent 调用循环（含 approval 处理）

```
runAgentLoop(model, system, tools, messages):
  while (true):
    result = await generateText({
      model,
      system,
      tools,
      messages,
      stopWhen: stepCountIs(10),
    })

    // 将 LLM 响应加入历史
    messages.push(...result.response.messages)

    // 检查是否有 approval 请求
    approvalRequests = result.content.filter(p => p.type === 'tool-approval-request')

    if (approvalRequests.length === 0):
      // 无 approval 请求 → 输出文本结果并结束
      textParts = result.content.filter(p => p.type === 'text')
      for (part of textParts):
        console.log(part.text)
      break

    // 处理 approval 请求
    approvals: ToolApprovalResponse[] = []
    for (req of approvalRequests):
      // 展示待确认的操作
      logger.info(`工具调用: ${req.toolCall.toolName}`)
      console.log(JSON.stringify(req.toolCall.input, null, 2))

      confirmed = await p.confirm({
        message: '是否执行此操作？',
      })

      if (p.isCancel(confirmed)):
        confirmed = false

      approvals.push({
        type: 'tool-approval-response',
        approvalId: req.approvalId,
        approved: confirmed,
        reason: confirmed ? '用户已确认' : '用户已拒绝',
      })

    // 将 approval 响应加入消息
    messages.push({ role: 'tool', content: approvals })
    // 继续循环 → 再次调用 generateText 处理结果
```

**设计决策**：
- **外层 while 循环处理 approval**：每次 `generateText` 返回后检查是否有 approval 请求。有则处理后重新调用；无则输出文本并退出。
- **stepCountIs(10)**：限制单次对话最多 10 步工具调用，防止无限循环。
- **approval 展示**：用 consola 显示工具名 + 参数 JSON，用 @clack/prompts confirm 获取确认。
- **/model 命令**：直接修改内存中的 config.ai 并重新获取 model，不持久化——仅当前会话有效。

---

### 文件：`src/index.ts` — 入口改造

#### 修改前

```typescript
import { defineCommand, runMain } from 'citty'
import { envCommand } from '@/commands/env.ts'
import { exampleCommand } from '@/commands/example.ts'

const main = defineCommand({
  meta: { name: 'ycli', version: '0.1.0', description: '个人 CLI 工具集' },
  subCommands: { env: envCommand, example: exampleCommand },
})

runMain(main)
```

#### 修改后

```typescript
import { defineCommand, runMain } from 'citty'
import { envCommand } from '@/commands/env.ts'

const main = defineCommand({
  meta: { name: 'ycli', version: '0.1.0', description: '个人 AI Agent' },
  args: {
    env: {
      type: 'string',
      description: '指定环境',
    },
  },
  async run({ args }) {
    // 无子命令时启动 Agent REPL
    const { startAgent } = await import('@/agent/index.ts')
    await startAgent(args.env)
  },
  subCommands: {
    env: envCommand,
  },
})

runMain(main)
```

**关键变化**：
1. 删除 `exampleCommand` 引用和 import
2. 添加 `args.env` 支持 `--env` 参数
3. 添加 `run` 回调，动态 import agent 模块（避免在 `ycli env` 等命令时加载 AI SDK）
4. description 更新为"个人 AI Agent"
5. `subCommands` 中移除 `example`

#### 文件删除

- 删除 `src/commands/example.ts`

---

### 文件：`src/agent/__tests__/repl.test.ts`

#### 测试策略

使用 `MockLanguageModelV4`（from `ai/test`）mock LLM 响应，测试核心逻辑：

```
describe('Agent REPL', () => {
  describe('buildSystemPrompt', () => {
    it('包含环境名称')
      - 传入 config + env='dev'
      - 验证返回字符串包含 'dev'

    it('包含数据库连接信息')
      - 验证包含 mysql host 和 database

    it('MongoDB URI 脱敏')
      - 传入含密码的 URI
      - 验证密码被隐藏

    it('无 HTTP 配置时不显示 HTTP 信息')
      - 传入无 http 的 config
      - 验证不包含 'HTTP Base URL'
  })

  describe('generateText 集成', () => {
    it('纯文本回复')
      - MockLanguageModelV4 doGenerate 返回 text content
      - 验证 generateText 结果包含文本

    it('工具调用自动执行（读工具）')
      - MockLanguageModelV4 doGenerate 返回 tool-call content
      - 传入 mock 过的 tools
      - 验证工具被调用

    it('写工具产生 approval request')
      - 配置带 needsApproval: true 的工具
      - 验证 result.content 中包含 tool-approval-request 类型

    it('approval 拒绝后模型收到拒绝信息')
      - 构造 ToolApprovalResponse { approved: false }
      - 加入 messages 后再次 generateText
      - 验证模型能继续对话
  })
})
```

#### Mock 策略

```typescript
import { MockLanguageModelV4 } from 'ai/test'

// 纯文本回复
new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ type: 'text', text: '你好！' }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    },
    warnings: [],
  }),
})
```

**注意**：
- 任务规格原先提到 `MockLanguageModelV3`，但根据 AI SDK 最新文档，v6.x 最新版使用 `MockLanguageModelV4`。实施时以实际安装版本为准——先 `import { MockLanguageModelV4 } from 'ai/test'`，如不存在则回退 `MockLanguageModelV3`。
- REPL 循环本身（readline 交互）不做自动化测试——它是 IO 绑定的，通过手动验证覆盖。测试重点放在 `buildSystemPrompt` 和 `generateText` 集成逻辑。

---

### 更新：`.agentdocs/architecture.md`

在目录结构中添加 `src/agent/` 模块：

```
├── agent/                # AI Agent 核心
│   ├── index.ts          # REPL 主循环
│   ├── provider.ts       # 多 provider 管理
│   ├── system-prompt.ts  # 动态 system prompt
│   └── tools/            # Agent 工具定义
│       ├── index.ts      # 聚合导出
│       ├── mysql.ts      # MySQL 读写工具
│       ├── mongo.ts      # MongoDB 读写工具
│       └── http.ts       # HTTP 请求工具
```

新增 Agent 架构说明段落：
- Agent 入口和 REPL 循环
- Provider 管理方式
- 工具读写分离 + approval 流程
- 启动方式：`ycli` 无参数 → Agent REPL

## 错误追踪

| 错误描述 | 尝试次数 | 解决方案 |
|----------|----------|----------|
| （暂无） | | |
