# 05 - REPL 循环与消息历史

## REPL 基本结构

`src/agent/index.ts` 的 `startAgent` 用 Node.js `readline` 构建交互循环：

```typescript
const rl = readline.createInterface({ input: stdin, output: stdout })

while (true) {
  const input = await rl.question('> ')
  if (!input.trim()) continue

  // 处理内置命令
  if (input === '/quit' || input === '/exit') { rl.close(); break }
  if (input === '/clear') { messages = []; continue }
  if (input.startsWith('/model ')) { /* 切换模型 */ continue }

  // 正常对话
  messages.push({ role: 'user', content: input })
  rl.pause()
  await runAgentLoop(model, system, tools, messages)
  rl.resume()
}
```

## readline 与 @clack/prompts 的 stdin 冲突

`readline` 和 `@clack/prompts` 都读取 `stdin`。当 `generateText` 执行写工具时，工具 `execute` 内部会调用 `p.confirm()`（@clack/prompts），此时 readline 的监听器还在——两者争抢 stdin 会导致输入被吞或行为异常。

解决方式：在调用 `runAgentLoop` 前暂停 readline，结束后恢复：

```typescript
rl.pause()
try {
  await runAgentLoop(model, system, tools, messages)
} finally {
  rl.resume()
}
```

## 消息历史管理

`messages` 数组存储对话历史，格式为 `{ role: 'user' | 'assistant', content: string }[]`。

`generateText` 执行期间，SDK 内部会产生 tool-call、tool-result 等中间消息。这些消息格式在 Chat Completions API（OpenRouter 等）的后续请求中不被接受，如果追加到 `messages` 会导致下一轮对话报错。

因此 `runAgentLoop` 只将最终文本加入历史：

```typescript
// src/agent/index.ts
if (result.text) {
  messages.push({ role: 'assistant', content: result.text })
}
```

工具调用过程和中间结果不保留。LLM 在文本回答中通常会总结工具调用结果，足以维持后续对话上下文。

## 内置命令

| 命令 | 行为 |
|------|------|
| `/quit` / `/exit` | 关闭 readline，退出进程 |
| `/clear` | `messages = []`，清空对话历史 |
| `/model provider:model-id` | 重建 model 实例，仅当前会话有效 |

内置命令在 `rl.question` 返回后、`messages.push` 之前处理，不会进入对话历史。
