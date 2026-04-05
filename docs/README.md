# ycli Agent 开发文档

本目录记录 ycli 项目中 Agent 开发的核心设计，供阅读代码时参考。文档面向 AI 代理，以"这个项目是怎么做的、为什么这样做"为主线，不做通用概念科普。

## 阅读顺序

| 文档 | 内容 |
|------|------|
| [01-what-is-agent.md](./01-what-is-agent.md) | Agent 与普通 LLM 对话的核心区别：工具调用循环 |
| [02-vercel-ai-sdk.md](./02-vercel-ai-sdk.md) | Vercel AI SDK 的 `generateText`、`tool()`、`stopWhen` |
| [03-tool-system.md](./03-tool-system.md) | 工具分类、工具定义结构、写操作确认流程 |
| [04-multi-provider.md](./04-multi-provider.md) | 多 Provider 注册与 OpenRouter 兼容处理 |
| [05-repl-and-messages.md](./05-repl-and-messages.md) | REPL 循环、stdin 竞争、消息历史裁剪 |
| [06-system-prompt.md](./06-system-prompt.md) | System Prompt 动态构建与工作流引导 |

## 技术栈速览

| 层 | 选型 |
|----|------|
| 运行时 | Bun |
| CLI 框架 | citty |
| 交互 UI | @clack/prompts |
| LLM 框架 | Vercel AI SDK v6（`ai` 包） |
| LLM Provider | @ai-sdk/anthropic、@ai-sdk/openai、ollama-ai-provider-v2 |
| 参数校验 | zod |
