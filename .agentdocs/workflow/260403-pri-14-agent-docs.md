> Linear: https://linear.app/wisdom21/issue/PRI-14/用worktree写文档

# PRI-14：用 worktree 写文档

## 当前状态速览

| 问题 | 回答 |
|------|------|
| 当前在哪个阶段？ | 完成 |
| 下一步做什么？ | 用户确认后执行 /done |
| 任务目标是什么？ | 在 docs/ 目录下写入面向 Agent 开发的入门文档，结合项目实际代码 |
| 关键发现有哪些？ | 见阶段性结论 |
| 已完成了什么？ | 见 TODO |

## 背景

项目用到了 Vercel AI SDK、citty、@clack/prompts 等框架，用户希望在项目目录下新建 `docs/` 文件夹，写入文档讲解 Agent 开发基础知识，结合项目实际代码。`doc-101` 分支与 worktree 已存在。

## 方案设计

在项目根目录新建 `docs/` 文件夹，共 7 个文档文件：

```
docs/
├── README.md                 # 目录与阅读指引
├── 01-what-is-agent.md       # AI Agent 概念与工具调用循环
├── 02-vercel-ai-sdk.md       # Vercel AI SDK 核心用法
├── 03-tool-system.md         # 工具系统设计与确认流程
├── 04-multi-provider.md      # 多 Provider 管理
├── 05-repl-and-messages.md   # REPL 循环与消息历史
└── 06-system-prompt.md       # System Prompt 工程
```

写作原则：精炼准确，代码片段取自实际源文件，以"这个项目是怎么做的、为什么这样做"为主线。

## TODO

- [x] 创建 docs/README.md
- [x] 创建 docs/01-what-is-agent.md
- [x] 创建 docs/02-vercel-ai-sdk.md
- [x] 创建 docs/03-tool-system.md
- [x] 创建 docs/04-multi-provider.md
- [x] 创建 docs/05-repl-and-messages.md
- [x] 创建 docs/06-system-prompt.md
- [x] 更新 .agentdocs/index.md

## 阶段性结论

- 7 个文档文件已全部创建于 `docs/` 目录，所有代码片段均取自实际源文件
- 写操作确认流程、OpenRouter 兼容处理、stdin 竞争问题均已在对应文档中说明
- `.agentdocs/index.md` 已更新，指向 `docs/README.md` 和本任务文档

## 错误追踪

| 错误描述 | 尝试次数 | 解决方案 |
|----------|----------|----------|
