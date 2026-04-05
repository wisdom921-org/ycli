# 03 - 工具系统设计

## 工具分类

10 个工具按类别分组：

| 类别 | 工具 | 说明 | 需用户确认 |
|------|------|------|:---:|
| MySQL 自省 | mysqlListTables | 列出所有表（含注释、行数） | - |
| MySQL 自省 | mysqlDescribeTable | 表结构、索引、样本数据 | - |
| MySQL 读 | mysqlQuery | 只读查询（SELECT/SHOW/DESC 等） | - |
| MySQL 写 | mysqlExecute | 写操作（INSERT/UPDATE/DELETE/DDL） | ✓ |
| MongoDB 自省 | mongoListCollections | 列出所有集合（含文档数） | - |
| MongoDB 自省 | mongoDescribeCollection | 采样推断字段结构 | - |
| MongoDB 读 | mongoQuery | find/findOne/countDocuments | - |
| MongoDB 读 | mongoAggregate | 聚合管道 | - |
| MongoDB 写 | mongoExecute | 写操作（insert/update/delete） | ✓ |
| HTTP | httpRequest | HTTP 请求 | GET 免确认，其他 ✓ |

自省工具优先：LLM 在执行任何查询前，必须先调用自省工具了解 schema（由 system prompt 中的 Look → Plan → Query 工作流强制要求）。

## 写操作确认流程

写工具（mysqlExecute、mongoExecute、非 GET 的 httpRequest）在 `execute` 内部用 `@clack/prompts` 弹确认：

```typescript
// src/agent/tools/mysql.ts - createMysqlExecute
execute: async ({ sql }) => {
  logger.info('工具调用: mysqlExecute')
  console.log(sql)
  let confirmed = await p.confirm({ message: '是否执行此 SQL？' })
  if (p.isCancel(confirmed)) confirmed = false
  if (!confirmed) return { error: '用户已拒绝此操作' }

  const conn = await getMysqlConnection(envOverride)
  const [result] = await conn.execute(sql)
  return { result }
}
```

拒绝时返回 `{ error: '用户已拒绝此操作' }`，LLM 收到后会在文本中向用户说明。

## 为什么不用 AI SDK 的 needsApproval

AI SDK 提供了 `needsApproval` 机制，会在消息数组中插入 `tool-approval-response` 类型的消息。但这种消息格式只兼容 Anthropic 的 Responses API，OpenRouter 等使用 Chat Completions API 的 provider 会拒绝包含该消息的请求。

将确认逻辑移入 `execute` 内部，消息数组中只有标准的 tool-call + tool-result，两种 API 都兼容。

## 安全措施

mysqlDescribeTable 对表名做了双重校验（`src/agent/tools/mysql.ts:37-45`）：

```typescript
// 1. 格式白名单：只允许字母、数字、下划线
if (!/^[a-zA-Z0-9_]+$/.test(table)) {
  return { error: `表名 '${table}' 包含非法字符` }
}
// 2. 存在性验证：查 INFORMATION_SCHEMA 确认表存在
const [tableCheck] = await conn.query(
  'SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
  [table],
)
```

mysqlQuery 检查 SQL 前缀白名单，只允许 SELECT/SHOW/DESCRIBE/EXPLAIN/WITH，防止通过读工具执行写操作。

## 数据截断

查询结果超过 500 行时自动截断，返回截断提示要求 LLM 添加过滤条件。MongoDB 的 `mongoDescribeCollection` 采样 5 个文档推断字段类型，不拉取全量数据。
