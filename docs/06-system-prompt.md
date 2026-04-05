# 06 - System Prompt 工程

## 动态构建

`src/agent/system-prompt.ts` 的 `buildSystemPrompt` 在每次 `startAgent` 时调用，将运行时信息注入 prompt：

```typescript
export const buildSystemPrompt = (config: Config, env?: string | null): string => {
  const lines = [
    '你是 ycli，一个个人 AI 助手，运行在用户的终端中。',
    '',
    '## 当前环境',
    `- 环境名称：${env ?? '未知'}`,
    `- MySQL：${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`,
    `- MongoDB：${maskMongoUri(config.mongo.uri)}`,
    // ...
  ]
  return lines.join('\n')
}
```

注入的信息包括：工具能力清单、工作流规范、当前环境连接信息（MongoDB URI 脱敏）、业务规则、可选业务上下文。

## System Prompt 的四个部分

**能力清单**：列出所有 10 个工具的名称和用途，让 LLM 知道有哪些工具可用。

**工作流规范（Look → Plan → Query）**：强制要求 LLM 在执行任何数据库操作前先调用自省工具：

```
1. Look：先调用 mysqlListTables/mongoListCollections 了解 schema
2. Plan：根据 schema 规划查询方案
3. Query：执行实际查询或写操作
```

这避免了 LLM 编造不存在的表名、字段名。

**当前环境信息**：MySQL 和 MongoDB 的连接信息（数据库名、host）。LLM 会在回答中引用这些信息，例如明确说明操作的是哪个数据库。

**业务规则**：6 条简洁规则，例如"写操作前先用读工具确认数据状态"、"不要编造不存在的表名"。

## 外部业务上下文注入

`~/.ycli/business-context.md` 如果存在，会追加到 prompt 末尾：

```typescript
const businessContext = loadBusinessContext()  // 读取 ~/.ycli/business-context.md
if (businessContext) {
  lines.push('', '## 业务上下文', '', businessContext)
}
```

用途：注入项目特定的业务知识，例如表的业务含义、字段的取值规范、常用查询模式。此文件不纳入版本控制，每个人可以维护自己的业务上下文。

## 设计原则

- 工具描述写在 `tool()` 的 `description` 里，system prompt 只写调用时机和优先级，不重复描述每个工具的参数
- 规则用数字列表，简短且可验证，避免模糊的指导性语言
- 连接信息脱敏后注入（MongoDB URI 隐藏密码），在终端日志中不暴露凭据
