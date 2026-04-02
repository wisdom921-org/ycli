# ycli 技术架构

## 技术栈

| 模块 | 选型 | 说明 |
|------|------|------|
| 运行时 | Bun | 高性能 JavaScript 运行时 |
| CLI 框架 | citty | 轻量级命令行框架 |
| 交互 UI | @clack/prompts | 美观的交互式提示 |
| 日志输出 | consola | 统一日志管理 |
| HTTP 请求 | ofetch | 现代 HTTP 客户端 |
| MySQL ORM | drizzle-orm | 类型安全的 ORM |
| MongoDB ODM | mongoose | MongoDB 对象建模 |
| 配置校验 | zod | 运行时类型校验 |
| 代码工具 | biome | 代码格式化与检查 |
| LLM 框架 | ai (Vercel AI SDK v6) | 统一多 provider 接口，内置 tool calling + approval |
| LLM Provider | @ai-sdk/anthropic, @ai-sdk/openai, ollama-ai-provider-v2 | Claude / OpenAI / 本地 Ollama / OpenRouter（复用 @ai-sdk/openai） |
| 测试 | vitest（通过 `bun --bun` 运行） | 单元测试，支持 AI SDK mock provider |

## 目录结构

```
ycli/
├── src/
│   ├── index.ts              # CLI 入口，命令注册
│   ├── commands/             # 命令实现
│   ├── agent/                # AI Agent 核心
│   │   ├── index.ts          # REPL 主循环（startAgent + runAgentLoop）
│   │   ├── provider.ts       # 多 provider 管理（createRegistry + getModel）
│   │   ├── system-prompt.ts  # 动态 system prompt（含业务上下文注入）
│   │   └── tools/            # Agent 工具定义（MySQL 4 + MongoDB 5 + HTTP 1）
│   ├── services/             # 业务逻辑层
│   │   ├── db/               # 数据库服务
│   │   └── http/             # HTTP 服务
│   ├── config/               # 配置管理
│   │   └── __tests__/        # 配置单元测试
│   └── utils/                # 工具函数
├── scripts/                  # 构建脚本
├── homebrew/                 # Homebrew Formula 模板
├── drizzle/                  # MySQL Schema
└── models/                   # MongoDB Models
```

## 配置管理

### 配置文件位置

- 配置目录：`~/.ycli/`
- 环境配置：`~/.ycli/config.{env}.json`
- 当前环境：`~/.ycli/.current`

### 环境切换

- `ycli env init` - 交互式初始化配置
- `ycli env use <env>` - 切换环境
- `ycli env list` - 列出所有环境
- `ycli env show` - 显示当前配置
- `ycli env set <key> <value>` - 直接修改配置字段（如 `ai.model`、`ai.provider`）

### 临时覆盖

所有命令支持 `--env` 参数临时使用指定环境，不影响 `.current` 文件。

### AI 配置（可选）

`ycli env init` 可选配置 AI 助手，存储在 config 文件的 `ai` 段中：

- `provider`：LLM 提供商（`anthropic` / `openai` / `ollama` / `openrouter`，默认 `anthropic`）
- `model`：模型 ID（默认 `claude-sonnet-4-20250514`）
- `anthropicApiKey` / `openaiApiKey` / `openrouterApiKey`：对应 provider 的 API Key
- `ollamaBaseUrl`：Ollama 服务地址（默认 `http://localhost:11434`）

配置修改：`ycli env set <key> <value>` 可直接修改字段（如 `ycli env set ai.model anthropic/claude-sonnet-4`），无需重跑 init。

## 数据库连接

### MySQL (Drizzle)

- 懒加载连接，首次调用 `getDb()` 时建立
- 单例模式，复用连接
- Schema 定义在 `drizzle/schema.ts`
- `getMysqlConnection()` 暴露 raw mysql2 connection，供 Agent 工具执行 raw SQL；与 `getDb()` 共享同一底层连接，外部禁止单独关闭

### MongoDB (Mongoose)

- 懒加载连接，首次调用 `connectMongo()` 时建立
- Model 定义在 `models/` 目录
- 使用完毕可调用 `disconnectMongo()` 断开

## HTTP 客户端

- 基于 ofetch 封装
- 从配置读取 baseUrl
- 预留拦截器扩展点（如鉴权）

## 构建与发布

### 构建目标

- darwin-arm64 (Apple Silicon)
- darwin-x64 (Intel Mac)

### 发布流程

1. 更新 package.json 版本号
2. 创建 Git Tag
3. GitHub Actions 自动构建并发布到 Release
4. 自动更新 Homebrew Tap

### 安装方式

```bash
brew tap wisdom921/tap
brew install ycli
```

## AI Agent

### 启动方式

- `ycli`（无子命令）→ 启动 Agent REPL 交互循环
- `ycli --env prd` → 指定环境启动

### REPL 循环

1. 用户输入 → 加入 messages 历史
2. 调用 `generateText`（带 tools 定义，`stopWhen: stepCountIs(10)`）
3. 检查返回结果：
   - 纯文本 → 输出到终端
   - 读工具调用 → SDK 自动执行 → 结果回传 LLM → 继续
   - 写工具调用 → `needsApproval` 暂停 → `@clack/prompts` confirm → 构造 `tool-approval-response` → 继续

### 内置命令

- `/quit` `/exit` — 退出
- `/clear` — 清空对话历史
- `/model provider:model-id` — 临时切换模型（仅当前会话）

### System Prompt

- 动态构建，包含当前环境信息（MySQL/MongoDB/HTTP 连接信息）
- 注入 "Look → Plan → Query" 工作流引导（先自省 schema，再规划，再查询）
- 可选注入 `~/.ycli/business-context.md` 业务上下文

### 工具层

10 个工具，读写分离 + approval 流程：

| 类别 | 工具 | 说明 | needsApproval |
|------|------|------|:---:|
| MySQL 自省 | mysqlListTables | 列出所有表 | - |
| MySQL 自省 | mysqlDescribeTable | 表结构 + 样本行 | - |
| MySQL 读 | mysqlQuery | 只读查询 | - |
| MySQL 写 | mysqlExecute | 写操作 | ✓ |
| MongoDB 自省 | mongoListCollections | 列出所有集合 | - |
| MongoDB 自省 | mongoDescribeCollection | 采样推断结构 | - |
| MongoDB 读 | mongoQuery | find/findOne/count | - |
| MongoDB 读 | mongoAggregate | 聚合管道 | - |
| MongoDB 写 | mongoExecute | 写操作 | ✓ |
| HTTP | httpRequest | HTTP 请求 | 非 GET |

## 已知问题与 Workaround

### Bun + Vitest 模块解析 bug

**问题**：Bun 的 SSR 模块求值器对 `import * as X from '...'; export { X }` 命名空间重导出模式求值失败，导致导出值为 `undefined`。Zod 4 内部使用了此模式，在 Vitest 下 `import { z } from 'zod'` 会得到 `undefined`。

**追踪**：[oven-sh/bun#21614](https://github.com/oven-sh/bun/issues/21614)。影响 Bun 1.3.x + Vitest 4 + 任何使用命名空间重导出的包。Vitest 官方不打算修复（[vitest#5551](https://github.com/vitest-dev/vitest/issues/5551)），认为属于 Bun 侧问题。

**Workaround**：在 `vitest.config.ts` 中添加 `resolve.alias` 直接指向源文件，绕过 package exports 解析：

```typescript
resolve: {
  alias: {
    zod: resolve(__dirname, 'node_modules/zod/src/index.ts'),
  },
}
```

同时 test 脚本需使用 `bun --bun vitest run`（而非 `vitest run`，后者会走 Node 运行时）。

**注意**：后续新增依赖若在 Vitest 中出现 `undefined is not an object` 错误，优先检查该依赖是否使用了命名空间重导出模式，并用同样的 alias 方式解决。Bun 修复此 bug 后可移除所有相关 alias。
