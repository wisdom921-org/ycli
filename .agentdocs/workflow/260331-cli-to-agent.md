# ycli 改造：CLI 工具箱 → 个人 AI Agent

## 当前状态速览

| 问题 | 回答 |
|------|------|
| 当前在哪个阶段？ | 子任务 1-2 已完成，待实施子任务 3 |
| 下一步做什么？ | 实施子任务 3：工具层 |
| 任务目标是什么？ | 将 ycli 从 CLI 工具箱改造为个人 AI Agent |
| 关键发现有哪些？ | 见阶段性结论 |
| 已完成了什么？ | 见 TODO |

## 背景

ycli 当前是 v0.1.0 的 CLI 脚手架，只有 env 配置管理和 example 示例命令。用户核心诉求是**操作业务数据库（MySQL/MongoDB）+ 执行运维管理任务 + 发送 HTTP 请求**，逐个实现 CLI 命令效率低且不灵活，Agent 形态更适合——自然语言驱动、工具自动编排、写操作需确认。

## 方案设计

### 技术选型

| 模块 | 选型 | 理由 |
|------|------|------|
| LLM 框架 | Vercel AI SDK (`ai` v6) | 统一多 provider API，内置 tool calling + approval 流程 |
| Provider | `@ai-sdk/anthropic` + `@ai-sdk/openai` + `ollama-ai-provider-v2` + OpenRouter（复用 `@ai-sdk/openai`） | 覆盖云端 + 本地 + 多模型网关 |
| 交互 | `readline` + `@clack/prompts` | readline 做 REPL 输入，clack 做写操作确认 |
| 流式输出 | `streamText` + `textStream` async iterator | 终端实时输出 |
| 测试 | Vitest | AI SDK 官方 mock provider 支持，异步性能优于 Bun Test |
| 其余 | 复用现有 Drizzle/Mongoose/ofetch/zod/consola | 不引入额外依赖 |

### 核心架构

```
ycli（无子命令）→ 启动 Agent REPL
ycli env ...    → 现有环境管理命令

Agent REPL 循环：
  用户输入 → LLM（带 tools 定义）→
    ├── 直接回复文本 → 流式输出到终端
    ├── 调用读工具 → 自动执行 → 结果回传 LLM → 继续
    └── 调用写工具 → needsApproval 暂停 → 用户确认 → 执行/拒绝 → 继续
```

### 新增目录结构

```
src/agent/
├── index.ts              # REPL 主循环
├── provider.ts           # createProviderRegistry 多 provider 管理
├── system-prompt.ts      # 动态 system prompt 构建
└── tools/
    ├── index.ts           # 聚合导出所有 tools
    ├── mysql.ts           # mysqlQuery(读) + mysqlExecute(写,需确认)
    ├── mongo.ts           # mongoQuery(读) + mongoExecute(写,需确认)
    └── http.ts            # httpRequest(GET 免确认，其余需确认)
```

### 需修改的现有文件

- `src/config/env.ts` — 扩展 ConfigSchema，增加 `ai` 配置段
- `src/commands/env.ts` — `ycli env init` 增加 AI 配置交互
- `src/index.ts` — 无子命令时启动 Agent REPL（动态 import）
- `src/commands/example.ts` — 删除
- `package.json` — 添加 AI SDK + Vitest 依赖

## TODO

### 子任务 1：基础设施（依赖 + 配置 + env init）→ [详细规格](260331-cli-to-agent/subtask-1-infrastructure.md)

- [x] 安装依赖（AI SDK + Vitest）
- [x] 新建 `vitest.config.ts` + 更新 package.json scripts
- [x] 修改 `src/config/env.ts` 增加 ai 配置段
- [x] 修改 `src/commands/env.ts` 增加 AI 配置交互
- [x] 新建配置层测试（env.test.ts + index.test.ts）
- [x] lint + typecheck + test + 手动验证

### 子任务 2：Provider 层（含 OpenRouter 支持）→ [详细规格](260331-cli-to-agent/subtask-2-provider.md)

- [x] 修改 `src/config/env.ts`（ConfigSchema 新增 openrouter）
- [x] 修改 `src/commands/env.ts`（env init + env show + 新增 env set 命令）
- [x] 新建 `src/agent/provider.ts`（四 provider 注册 + getModel）
- [x] 更新/新建测试（env.test.ts + provider.test.ts）
- [x] lint + typecheck + test 验证
- [x] 修复 vitest + Bun 兼容（Zod 4 alias + test 脚本改用 `bun --bun`）

### 子任务 3：工具层 → [详细规格](260331-cli-to-agent/subtask-3-tools.md)

- [ ] 新建 MySQL/MongoDB/HTTP tools（读写分离 + needsApproval）
- [ ] 测试 + lint + typecheck 验证

### 子任务 4：Agent REPL → [详细规格](260331-cli-to-agent/subtask-4-repl.md)

- [ ] 新建 system prompt + REPL 循环 + 入口改造
- [ ] 测试 + lint + typecheck + build 验证
- [ ] 更新 `.agentdocs/architecture.md`

### 后续：体验增强

- [ ] 流式输出优化
- [ ] 会话历史持久化
- [ ] DB schema 自省工具
- [ ] Markdown 渲染美化终端输出

### 后续：远程接入

- [ ] Telegram Bot 接入
- [ ] SSH 远程访问

## 阶段性结论

### 1. AI SDK API 验证（2026-03-31）

- `needsApproval: true` 在 tool 定义上设置，`generateText` 返回 `tool-approval-request` 类型的 content part
- 通过 `ToolApprovalResponse` 构造确认/拒绝响应，push 到 messages 后再次调用 `generateText` 继续
- `createProviderRegistry` 支持注册多个 provider，通过 `registry.languageModel('anthropic:model-id')` 访问
- `ollama-ai-provider-v2` 包支持 `createOllama({ baseURL })` 自定义地址
- `streamText` 的 `textStream` 支持 `for await` 异步迭代实现终端流式输出

> 沉淀：无需（API 用法随版本变化，以实现时文档为准）

### 2. 架构决策（2026-03-31）

- 选用 Vercel AI SDK 而非 Claude Agent SDK：后者仅限 Claude，且偏向有状态长运行 Agent；AI SDK 多 provider 支持是硬需求
- REPL 用 readline 而非 ink：ink 太重，个人工具不需要 React 渲染层
- 写操作确认用 AI SDK 原生 approval 流程而非自行拦截：减少自定义代码，SDK 原生支持更可靠
- 测试框架选 Vitest 而非 Bun Test：AI SDK 官方 mock provider、异步性能 15x 优、fake timers 支持

> 沉淀：待定（实施完成后评估是否需要写入 architecture.md）

### 3. Provider 层实施（2026-04-01）

- 四 provider 支持：Anthropic、OpenAI、Ollama、OpenRouter（用户主要使用 Ollama + OpenRouter）
- OpenRouter 复用 `createOpenAI({ baseURL: 'https://openrouter.ai/api/v1' })`，无额外依赖
- `createRegistry()` 无状态设计，每次调用创建新 registry（仅启动和切换模型时调用）
- `ycli env set` 新命令支持直接修改配置字段，如 `ycli env set ai.model anthropic/claude-sonnet-4`
- Vitest 4 + Bun 兼容 bug（[oven-sh/bun#21614](https://github.com/oven-sh/bun/issues/21614)）：Bun 的 SSR 模块求值器对 `import *; export { name }` 命名空间重导出模式求值失败，Zod 4 内部使用了此模式导致 `z` 为 `undefined`。Workaround：vitest.config.ts 添加 `zod` alias 指向 `node_modules/zod/src/index.ts`；test 脚本改用 `bun --bun vitest run`

> 沉淀：已写入 `architecture.md`「已知问题与 Workaround」段落
