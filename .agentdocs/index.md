# ycli 项目文档索引

## 技术文档

`architecture.md` - 项目技术架构与设计决策，修改任何代码时必读

## 活跃任务

`workflow/260331-cli-to-agent.md` - 将 ycli 从 CLI 工具箱改造为个人 AI Agent

## 全局重要记忆

- **CLI 框架**：使用 citty 构建命令行界面
- **交互 UI**：使用 @clack/prompts 实现交互式输入
- **配置存储**：`~/.ycli/` 目录下，通过 `ycli env` 命令管理
- **数据库**：Drizzle ORM (MySQL) + Mongoose (MongoDB)，按需懒加载连接
- **构建目标**：仅 macOS (darwin-arm64, darwin-x64)
- **分发方式**：Homebrew Tap (wisdom921/tap)
- **AI SDK**：Vercel AI SDK v6，支持 Anthropic/OpenAI/Ollama/OpenRouter 四 provider
- **测试框架**：Vitest（通过 `bun --bun` 运行），Zod 需 alias workaround，详见 architecture.md
- **AI 配置**：`ycli env init` 可选配置 AI 助手；`ycli env set` 可直接修改配置字段
