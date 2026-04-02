# ycli 项目文档索引

## 技术文档

`architecture.md` - 项目技术架构与设计决策，修改任何代码时必读
`testing.md` - 测试分层方案、已知坑点与验证清单，新增/修改测试时必读

## 活跃任务

（无）

## 全局重要记忆

- **CLI 框架**：使用 citty 构建命令行界面
- **交互 UI**：使用 @clack/prompts 实现交互式输入
- **配置存储**：`~/.ycli/` 目录下，通过 `ycli env` 命令管理
- **数据库**：Drizzle ORM (MySQL) + Mongoose (MongoDB)，按需懒加载连接
- **构建目标**：仅 macOS (darwin-arm64, darwin-x64)
- **分发方式**：Homebrew Tap (wisdom921/tap)
- **AI SDK**：Vercel AI SDK v6，支持 Anthropic/OpenAI/Ollama/OpenRouter 四 provider
- **测试框架**：Vitest（通过 `bun --bun` 运行），三层测试（单元 + CLI 子进程冒烟 + Agent 集成），详见 testing.md
- **AI 配置**：`ycli env init` 可选配置 AI 助手；`ycli env set` 可直接修改配置字段
- **OpenRouter provider**：当前用 `@ai-sdk/openai` + 自定义 baseURL，后续可考虑切换官方 `@openrouter/ai-sdk-provider`

## 后续待办

- 流式输出优化（`generateText` → `streamText`）
- 会话历史持久化
- Markdown 渲染美化终端输出
- 工具执行失败时在终端打印警告（当前错误只传给 LLM，用户不可见）
- Telegram Bot 接入
- SSH 远程访问
