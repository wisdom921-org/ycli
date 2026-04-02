# ycli 改造：CLI 工具箱 → 个人 AI Agent

## 当前状态速览

| 问题 | 回答 |
|------|------|
| 当前在哪个阶段？ | 已完成 |
| 下一步做什么？ | 无（后续待办已记录在 index.md） |
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
| LLM 调用 | `generateText`（初版）→ `streamText`（后续优化） | 初版先跑通非流式，后续切换流式输出 |
| 测试 | Vitest | AI SDK 官方 mock provider 支持，异步性能优于 Bun Test |
| 其余 | 复用现有 Drizzle/Mongoose/ofetch/zod/consola | 不引入额外依赖 |

### 核心架构

```
ycli            → 无子命令时启动 Agent REPL
ycli env ...    → 现有环境管理命令

Agent REPL 循环：
  用户输入 → LLM（带 tools 定义）→
    ├── 直接回复文本 → 输出到终端
    ├── 调用读工具 → 自动执行 → 结果回传 LLM → 继续
    └── 调用写工具 → needsApproval 暂停 → 用户确认 → 执行/拒绝 → 继续
```

### 新增目录结构

```
src/agent/
├── index.ts              # REPL 主循环
├── provider.ts           # createProviderRegistry 多 provider 管理
├── system-prompt.ts      # 动态 system prompt 构建（含业务上下文注入）
└── tools/
    ├── index.ts           # 聚合导出 createAgentTools()（共 10 个工具）
    ├── mysql.ts           # 自省(listTables/describeTable) + 读写(query/execute)
    ├── mongo.ts           # 自省(listCollections/describeCollection) + 读写(query/aggregate/execute)
    └── http.ts            # httpRequest(GET 免确认，其余需确认)
```

### 需修改的现有文件

- `src/config/env.ts` — 扩展 ConfigSchema，增加 `ai` 配置段
- `src/commands/env.ts` — `ycli env init` 增加 AI 配置交互
- `src/index.ts` — 删除 example，添加 `run` 回调（无子命令时启动 Agent REPL）
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

- [x] 修改 `src/services/db/drizzle.ts`（暴露 raw mysql2 connection）
- [x] 新建 MySQL tools（listTables + describeTable + query + execute，共 4 个工具）
- [x] 新建 MongoDB tools（listCollections + describeCollection + query + aggregate + execute，共 5 个工具）
- [x] 新建 HTTP tool（httpRequest，动态 needsApproval）
- [x] 新建 tools/index.ts 聚合导出（共 10 个工具）
- [x] 测试 + lint + typecheck 验证

### 子任务 4：Agent REPL → [详细规格](260331-cli-to-agent/subtask-4-repl.md)

- [x] 新建 system prompt + REPL 循环 + 入口改造
- [x] 测试 + lint + typecheck + build 验证
- [x] 更新 `.agentdocs/architecture.md`

### 运行时验证与集成测试（2026-04-02 补充）

- [x] 修复 Bug：citty 子命令路由后父命令 run 仍触发
- [x] 修复 Bug：未配置环境时 loadConfig 抛出未捕获异常
- [x] 新增 CLI 子进程冒烟测试（6 个用例）
- [x] 新增 Agent 循环集成测试（6 个用例）
- [x] 导出 runAgentLoop 供集成测试调用
- [x] 整理测试方案文档 `.agentdocs/testing.md`
- [x] typecheck + lint + test（76 个测试全部通过）

### 手动冒烟修复（2026-04-02 补充）

- [x] 修复：OpenRouter 默认走 Responses API，需强制指向 Chat Completions API
- [x] 重构：写操作确认从 AI SDK needsApproval 改为工具 execute 内部确认（兼容 Chat API）
- [x] 修复：消息历史只保留文本，不保留中间 tool-call/tool-result（避免 Chat API schema 不兼容）
- [x] 修复：readline 与 @clack/prompts 争抢 stdin，需 rl.pause/resume
- [x] 修复：LLM 传 JSON 字符串而非对象，mongoExecute/httpRequest 需 JSON.parse
- [x] typecheck + lint + test（75 个测试全部通过）

### 后续：体验增强

- [ ] 流式输出优化
- [ ] 会话历史持久化
- [ ] Markdown 渲染美化终端输出
- [ ] 工具执行失败时在终端打印警告（当前错误只传给 LLM，用户不可见）

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
- ~~写操作确认用 AI SDK 原生 approval 流程~~（已推翻：needsApproval 有多个已知 bug，改为工具 execute 内部确认，见结论 #7）
- 测试框架选 Vitest 而非 Bun Test：AI SDK 官方 mock provider、异步性能 15x 优、fake timers 支持

> 沉淀：无需（选型已体现在 architecture.md 技术栈表；needsApproval 推翻后新方案已在结论 #7 沉淀）

### 3. Provider 层实施（2026-04-01）

- 四 provider 支持：Anthropic、OpenAI、Ollama、OpenRouter（用户主要使用 Ollama + OpenRouter）
- OpenRouter 复用 `createOpenAI({ baseURL: 'https://openrouter.ai/api/v1' })`，无额外依赖
- `createRegistry()` 无状态设计，每次调用创建新 registry（仅启动和切换模型时调用）
- `ycli env set` 新命令支持直接修改配置字段，如 `ycli env set ai.model anthropic/claude-sonnet-4`
- Vitest 4 + Bun 兼容 bug（[oven-sh/bun#21614](https://github.com/oven-sh/bun/issues/21614)）：Bun 的 SSR 模块求值器对 `import *; export { name }` 命名空间重导出模式求值失败，Zod 4 内部使用了此模式导致 `z` 为 `undefined`。Workaround：vitest.config.ts 添加 `zod` alias 指向 `node_modules/zod/src/index.ts`；test 脚本改用 `bun --bun vitest run`

> 沉淀：已写入 `architecture.md`「已知问题与 Workaround」段落

### 4. 工具层设计讨论（2026-04-01）

- 工具总数从原规格 5 扩展到 10：新增 4 个 schema 自省工具（MySQL/MongoDB 各一对 listTables + describeTable）+ aggregate 独立拆分
- 自省工具是行业标配（LangChain/Oracle/Arcade.dev 均推荐），LLM 需先了解 schema 再生成查询（"Look → Plan → Query"）
- 查询结果兜底截断 500 行/条，配合 system prompt 引导 LLM 主动加 LIMIT
- `mysqlDescribeTable` 返回列注释（COLUMN_COMMENT）+ 样本行，对齐 LangChain 做法；表名通过 INFORMATION_SCHEMA 校验防注入
- `mongoDescribeCollection` 通过 `$sample` 采样推断字段结构，MongoDB 无固定 schema 时唯一可靠的发现方式
- 无合适第三方库：Vercel AI SDK 无预置 DB 工具，LangChain Toolkit 依赖 TypeORM 与 Drizzle 冲突，MCP Server 增加运行时复杂度。自实现 ~200 行、零额外依赖
- 子任务 4 的 system prompt 需配合：注入 `~/.ycli/business-context.md` 业务上下文 + "Look → Plan → Query" 工作流引导

> 沉淀：无需（工具设计已体现在 architecture.md 工具层表格和 system-prompt.ts 中）

### 5. 工具层实施（2026-04-01）

- 10 个工具按规格完成：MySQL 4 + MongoDB 5 + HTTP 1，通过 `createAgentTools(envOverride?)` 聚合导出
- Zod 4 的 `z.record()` 需要 key+value 两个参数（`z.record(z.string(), z.unknown())`），与 Zod 3 的单参数不同
- MongoDB Sort 类型兼容：`Record<string, number>` 不兼容 MongoDB driver 6.x 的 `Sort` 类型，需 `as unknown as Sort` 断言
- Vitest `vi.mock` 工厂函数会被提升到文件顶部，引用的 mock 变量必须通过 `vi.hoisted()` 声明
- 27 个工具层测试全部通过，typecheck + lint 零错误

> 沉淀：无需（实施细节随代码演进，不写入 architecture.md）

### 6. 运行时验证与 Bug 修复（2026-04-02）

- 实际运行 CLI 发现 2 个 bug：citty 子命令路由后父 run 仍触发（`ycli env list` 会同时启动 Agent）、未配置环境时 `loadConfig` 抛未捕获异常显示 stack trace
- 原有 64 个单元测试全是 mock 的，无法覆盖集成边界——正是这类测试盲区导致 bug 漏过
- 新增 CLI 子进程冒烟测试（参考 oclif/commander.js 行业标准，用 `child_process.spawn` 运行真实 CLI 进程检查输出）和 Agent 循环集成测试（用 AI SDK 官方 `MockLanguageModelV3` 让 `generateText` 走真实路径）
- 踩坑：Bun 的 `process.env` 是 Proxy，vitest 注入的 `TEST=true` 让 consola 静默输出，spread 后 delete 无法清除；最终用白名单方式构建子进程环境
- 测试方案已整理为 `.agentdocs/testing.md`

> 沉淀：已写入 `testing.md`（测试分层 + 坑点）和 `architecture.md`（citty workaround）

### 7. 手动冒烟与兼容性修复（2026-04-02）

- OpenRouter 的 `@ai-sdk/openai` 默认走 Responses API，工具调用时报 `Invalid Responses API request`。通过覆盖 `languageModel` 指向 `chat` 解决
- AI SDK 的 `needsApproval` 产生的 `tool-approval-response` 消息不兼容 Chat Completions API，导致后续请求报 schema 错误。**重构为工具 execute 内部确认**，去掉 needsApproval，确认/拒绝结果作为标准 tool result 返回
- `result.response.messages` 中的工具调用中间消息在 Chat API 后续请求中也不兼容。**改为只将最终文本加入消息历史**
- readline 与 @clack/prompts 争抢 stdin 导致确认后卡死。在 `runAgentLoop` 调用前后 `rl.pause()/resume()` 解决
- LLM 对 `z.unknown()` 类型字段可能传 JSON 字符串而非对象。mongoExecute 的 `data` 和 httpRequest 的 `body` 添加 `typeof === 'string' ? JSON.parse : identity` 处理
- 工具执行失败时错误只传给 LLM、用户不可见，导致 LLM 静默重试（最多 10 步）。记为后续体验增强项

> 沉淀：已写入 `architecture.md`（5 条已知问题/设计决策）
