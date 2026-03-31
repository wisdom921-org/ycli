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
- [ ] 新建测试
- [ ] lint + typecheck + test + build 验证
- [ ] 更新 `.agentdocs/architecture.md`

## 实施规格

> 详细规格在实施前编写。概要见主文档方案设计。

**核心要点**：

### system-prompt.ts
- 导出 `buildSystemPrompt(config, env?)` 返回字符串
- 内容：角色定位、可用工具列表及读写属性、当前环境信息、使用规则

### agent/index.ts（REPL 主循环）
- 导出 `startAgent(envOverride?)`
- 加载配置 → 初始化 provider → 构建 system prompt → readline REPL
- 使用 `generateText` + `stopWhen: stepCountIs(10)` 驱动工具调用循环
- 遍历 `result.content` 处理 `tool-approval-request`：展示参数 → `@clack/prompts` confirm → 构造 `ToolApprovalResponse` → 再次 `generateText`
- REPL 命令：`/quit`、`/model <provider:model>`、`/clear`

### index.ts 入口改造
- `defineCommand` 的 `run` 中动态 import agent（`await import('@/agent/index.ts')`）
- 保持 `ycli env` 等子命令正常工作

### 测试
- 使用 `MockLanguageModelV3`（from `ai/test`）mock LLM 响应
- 验证：纯文本回复、工具调用+自动执行、写工具 approval 暂停、approval 拒绝后模型收到拒绝信息

## 错误追踪

| 错误描述 | 尝试次数 | 解决方案 |
|----------|----------|----------|
| （暂无） | | |
