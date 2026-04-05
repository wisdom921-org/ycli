# 02 - Vercel AI SDK 核心用法

本项目使用 `ai` 包（Vercel AI SDK v6）。

## generateText

`generateText` 执行一次完整的 Agent 循环（含多步工具调用），返回最终文本：

```typescript
import { generateText, stepCountIs } from 'ai'

const result = await generateText({
  model,          // LanguageModel 实例
  system,         // system prompt 字符串
  tools,          // ToolSet（工具集合）
  messages,       // 对话历史
  stopWhen: stepCountIs(10),  // 最多 10 步工具调用后停止
})

result.text       // 最终文本回答
result.content    // 包含所有 part（text、tool-call 等）
```

本项目用 `generateText` 而不是 `streamText`，因为终端输出不需要流式渲染，且流式输出与 readline REPL 的 stdin 管理存在冲突。

## tool() API

用 `tool()` 定义一个工具，三个字段缺一不可：

```typescript
import { tool } from 'ai'
import { z } from 'zod'

const myTool = tool({
  description: '给 LLM 看的描述，说明这个工具做什么、何时用',
  inputSchema: z.object({
    tableName: z.string().describe('表名'),
  }),
  execute: async ({ tableName }) => {
    // 实际执行逻辑，返回值会回传给 LLM
    return { result: '...' }
  },
})
```

- `description`：LLM 依据此决定是否调用该工具，写得越精确，调用越准确
- `inputSchema`：zod schema，SDK 自动校验 LLM 传入的参数
- `execute`：工具执行函数，返回值序列化为 JSON 后传回 LLM

## ToolSet 组织方式

多个工具以普通对象的形式组合，key 就是工具名：

```typescript
// src/agent/tools/index.ts
export const createAgentTools = (envOverride?: string) => ({
  mysqlListTables: createMysqlListTables(envOverride),
  mysqlDescribeTable: createMysqlDescribeTable(envOverride),
  mysqlQuery: createMysqlQuery(envOverride),
  mysqlExecute: createMysqlExecute(envOverride),
  // ... 更多工具
})
```

工具以工厂函数形式创建（`createXxx(envOverride?)`），将环境参数通过闭包传入 `execute`，避免全局状态。

## stopWhen

`stepCountIs(10)` 表示工具调用步数达到 10 次后强制停止，防止 LLM 在复杂任务中无限循环。每次工具调用算一步。
