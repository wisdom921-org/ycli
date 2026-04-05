# 01 - AI Agent 是什么

## 与普通 LLM 对话的区别

普通 LLM 对话是单次问答：用户输入 → LLM 输出文本 → 结束。

Agent 的核心是**工具调用循环**：LLM 不只输出文本，还可以调用工具（函数）、获取结果、再决策、再调用……直到得出最终回答。

```
用户输入
  ↓
LLM 决策
  ↓ (需要数据)
调用工具（如 mysqlListTables）
  ↓
工具返回结果
  ↓
LLM 继续决策
  ↓ (需要更多信息)
调用工具（如 mysqlDescribeTable）
  ↓
工具返回结果
  ↓
LLM 生成最终文本回答
  ↓
输出给用户
```

这个循环在一次用户输入中可以执行多次，直到 LLM 认为信息足够，或达到步数上限。

## 在本项目中的体现

`src/agent/index.ts` 的 `runAgentLoop` 函数封装了一轮对话：

```typescript
const result = await generateText({
  model,
  system,
  tools,
  messages,
  stopWhen: stepCountIs(10),  // 最多执行 10 步工具调用
})
```

`generateText` 内部自动处理工具循环：当 LLM 返回 tool_call 时，SDK 执行对应工具的 `execute` 函数，将结果作为新消息追加，再次调用 LLM，如此循环。调用者不需要手动实现这个循环。

## 工具是什么

工具就是有明确签名的函数：名称、描述（给 LLM 看的）、参数 schema、执行逻辑。LLM 根据描述决定何时调用、传什么参数，但真正执行的是 TypeScript 代码。

本项目有 10 个工具，分为自省类（了解 schema）、读类（查数据）、写类（改数据）三种，详见 [03-tool-system.md](./03-tool-system.md)。
