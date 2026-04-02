# 子任务 4：Agent REPL

## 交付物

- `src/agent/system-prompt.ts`：基于环境配置动态构建 system prompt
- `src/agent/index.ts`：REPL 主循环，含 approval 确认流程
- `src/index.ts` 入口改造：无子命令时启动 Agent REPL
- 删除 `src/commands/example.ts`
- 端到端可用，`ycli` 启动交互式 Agent
- 测试 + build 通过

## TODO

- [x] 新建 `src/agent/system-prompt.ts`
- [x] 新建 `src/agent/index.ts`
- [x] 修改 `src/index.ts`
- [x] 删除 `src/commands/example.ts`
- [x] 新建测试 `src/agent/__tests__/repl.test.ts`
- [x] lint + typecheck + test + build 验证
- [x] 更新 `.agentdocs/architecture.md`

## 实施规格

### 文件：`src/agent/system-prompt.ts`

#### 依赖

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '@/config/env.ts'
import { CONFIG_DIR } from '@/config/paths.ts'
```

#### 导出

```typescript
export const buildSystemPrompt = (config: Config, env?: string | null): string
```

#### 业务上下文注入

函数内部尝试读取 `~/.ycli/business-context.md`，文件存在则将内容注入到 system prompt 末尾的「业务上下文」段落中。文件不存在则跳过，不报错。

```typescript
const loadBusinessContext = (): string | null => {
  try {
    return readFileSync(join(CONFIG_DIR, 'business-context.md'), 'utf-8')
  } catch {
    return null
  }
}
```

用户可在 `~/.ycli/business-context.md` 中自由编写业务背景信息（如表的业务含义、常用查询模式、字段枚举值说明等），Agent 会自动读取并用于理解用户意图。

#### System Prompt 模板

```
你是 ycli，一个个人 AI 助手，运行在用户的终端中。

## 能力
你可以通过工具执行以下操作：

### 数据库 Schema 自省（零成本调用，优先使用）
- **mysqlListTables**：列出 MySQL 所有表（含注释和预估行数）
- **mysqlDescribeTable**：查看指定表的列定义、索引和样本数据
- **mongoListCollections**：列出 MongoDB 所有集合（含预估文档数）
- **mongoDescribeCollection**：采样推断集合字段结构和类型

### 数据库读写
- **mysqlQuery**：执行 MySQL 只读查询（SELECT 等），自动执行
- **mysqlExecute**：执行 MySQL 写操作（INSERT/UPDATE/DELETE/DDL），需用户确认
- **mongoQuery**：查询 MongoDB 数据（find/findOne/countDocuments），自动执行
- **mongoAggregate**：执行 MongoDB 聚合管道，自动执行
- **mongoExecute**：执行 MongoDB 写操作，需用户确认

### HTTP 请求
- **httpRequest**：发起 HTTP 请求，GET 自动执行，其他方法需用户确认

## 工作流程：Look → Plan → Query
遇到数据库相关请求时，**必须**遵循以下三步流程：
1. **Look（查看结构）**：先调用自省工具（mysqlListTables/mysqlDescribeTable 或 mongoListCollections/mongoDescribeCollection）了解数据库 schema。**绝对不要跳过此步骤直接查询。**
2. **Plan（规划查询）**：根据 schema 信息规划查询方案，选择正确的表/集合名、字段名和查询条件。
3. **Query（执行查询）**：执行实际的查询或写操作。写操作执行前先用读操作确认当前数据状态。

在同一个对话中，如果已经 Look 过某个表/集合的 schema，不需要重复调用自省工具。

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

{businessContext ? `## 业务上下文\n\n${businessContext}` : ''}
```

**动态部分**：
- 环境名称从 `env` 参数获取
- 数据库连接信息从 `config` 提取，MongoDB URI 脱敏（隐藏密码）
- HTTP baseUrl 仅在配置存在时展示
- 业务上下文从 `~/.ycli/business-context.md` 读取，文件不存在则不展示该段落

---

### 文件：`src/agent/index.ts`

#### 依赖

```typescript
import * as readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { generateText, stepCountIs, type ToolSet } from 'ai'
import type { LanguageModel, ModelMessage } from 'ai'
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

使用 `MockLanguageModelV3`（from `ai/test`）mock LLM 响应，测试核心逻辑：

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

    it('包含所有 10 个工具名称')
      - 验证返回字符串包含 mysqlListTables、mysqlDescribeTable、
        mongoListCollections、mongoDescribeCollection、mongoAggregate 等全部工具名

    it('包含 Look → Plan → Query 工作流引导')
      - 验证返回字符串包含 'Look'、'Plan'、'Query' 三步描述
      - 验证包含"绝对不要跳过此步骤"的约束语句

    it('注入 business-context.md 内容')
      - mock readFileSync 返回测试业务上下文
      - 验证返回字符串包含该内容和"业务上下文"段落标题

    it('business-context.md 不存在时正常工作')
      - mock readFileSync 抛出 ENOENT
      - 验证返回字符串不包含"业务上下文"段落
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
import { MockLanguageModelV3 } from 'ai/test'

// 纯文本回复
new MockLanguageModelV3({
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
- AI SDK v6 内部使用 V3 provider 协议，mock 类为 `MockLanguageModelV3`（非 V4）。V3 tool-call content 使用 `input` 字段（非 `args`）。
- `maxSteps` 在 v6 中已移除，使用 `stopWhen: stepCountIs(N)` 替代。
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
| MockLanguageModelV3 tool-call 的 `args` 字段应为 `input`（V3 协议变更） | 2 | V3 spec 中 tool-call content 使用 `input: string` 而非 `args: string`，检查 `@ai-sdk/provider` 类型定义确认 |
| `maxSteps` 在 AI SDK v6 不存在 | 1 | 替换为 `stopWhen: stepCountIs(N)` |
| MockLanguageModelV3 的 `usage.inputTokens` 需要完整字段（noCache/cacheRead/cacheWrite） | 1 | 补全所有必需字段，提取为 `mockUsage` 常量复用 |
