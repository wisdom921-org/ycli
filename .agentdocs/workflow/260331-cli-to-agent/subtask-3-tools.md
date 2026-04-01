# 子任务 3：工具层

## 交付物

- MySQL 自省工具：`mysqlListTables`（表目录）+ `mysqlDescribeTable`（表结构 + 样本行）
- MySQL 操作工具：`mysqlQuery`（读，直接执行）+ `mysqlExecute`（写，needsApproval）
- MongoDB 自省工具：`mongoListCollections`（集合目录）+ `mongoDescribeCollection`（采样推断结构）
- MongoDB 操作工具：`mongoQuery`（读）+ `mongoAggregate`（聚合管道）+ `mongoExecute`（写，needsApproval）
- HTTP 工具：`httpRequest`（GET 免确认，其余 needsApproval）
- 聚合导出 `createAgentTools(envOverride?)`（共 10 个工具）
- 单元测试通过

## 设计讨论决策（2026-04-01）

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| 1 | 查询结果大小控制 | 工具层兜底截断 500 行/条 + system prompt 引导（子任务 4） | 兜底防护避免意外打爆 LLM 上下文 |
| 2 | MongoDB aggregate 参数 | 拆为独立 `mongoAggregate` 工具 | pipeline（数组）和 filter（对象）语义差异大 |
| 3 | HTTP 动态 needsApproval | 保持 `async ({ method }) => method !== 'GET'` 函数形式 | AI SDK v6 源码确认支持 null/boolean/function 三种形式 |
| 4 | 错误信息脱敏 | 暂不处理 | 个人工具无泄露风险，Telegram 接入时再加脱敏层 |
| 5 | Schema 自省工具 | 纳入子任务 3，新增 listTables + describeTable（含样本行） | 行业标配（LangChain/Oracle/Arcade.dev 均推荐），LLM 需要先了解 schema 再生成查询 |
| 6 | 表名注入防护 | mysqlDescribeTable 先查 INFORMATION_SCHEMA 验证表名存在 | 最可靠，只有实际存在的表才能查询 |
| 7 | 第三方库 vs 自实现 | 自己实现 | Vercel AI SDK 无预置 DB 工具；LangChain Toolkit 依赖 TypeORM（与 Drizzle 冲突）且不覆盖 MongoDB；MCP Server 增加运行时复杂度。自实现代码量小（~200 行）、零额外依赖 |

### 行业最佳实践参考

- **LangChain SQL Agent** 标配 4 工具：list_tables → get_schema(含样本行) → query → query_checker
- **Oracle AI Agent 指南**：schema 结构（必须）+ 表列描述（推荐）+ 示例查询（推荐）
- **Arcade.dev**："Look → Plan → Query" 工作流，自省工具必须在查询执行前运行

## TODO

- [x] 修改 `src/services/db/drizzle.ts`（暴露 raw mysql2 connection）
- [x] 新建 `src/agent/tools/mysql.ts`（4 工具：listTables + describeTable + query + execute）
- [x] 新建 `src/agent/tools/mongo.ts`（5 工具：listCollections + describeCollection + query + aggregate + execute）
- [x] 新建 `src/agent/tools/http.ts`（1 工具：httpRequest）
- [x] 新建 `src/agent/tools/index.ts`（聚合 10 个工具）
- [x] 新建测试 `src/agent/__tests__/tools.test.ts`
- [x] lint + typecheck + test 验证

## 实施规格

### 前置修改：`src/services/db/drizzle.ts`

当前 `getDb()` 内部创建的 mysql2 connection 是局部变量，无法用于执行 raw SQL。需要：

1. 将 `connection` 提升为模块级变量 `rawConnection`
2. 在 `getDb()` 内部创建连接后同时赋值给 `rawConnection`
3. 导出 `getMysqlConnection()` 函数

```typescript
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { loadConfig } from '@/config/index.ts'

let db: MySql2Database | null = null
let rawConnection: mysql.Connection | null = null  // 新增

export const getDb = async (envOverride?: string) => {
  if (db) return db
  const config = loadConfig(envOverride)
  rawConnection = await mysql.createConnection({  // 修改：赋值给模块变量
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
  })
  db = drizzle(rawConnection)
  return db
}

// 新增：暴露 raw connection 供 Agent 工具执行 raw SQL
export const getMysqlConnection = async (envOverride?: string) => {
  if (rawConnection) return rawConnection
  await getDb(envOverride)
  return rawConnection!
}
```

**设计决策**：共享同一个 connection 实例，避免创建多余连接。`getMysqlConnection()` 和 `getDb()` 使用相同的底层连接。

**连接生命周期约束**：`rawConnection` 与 `db` 共享同一底层连接，外部代码禁止单独关闭 `rawConnection`（否则 Drizzle 实例失效但仍被缓存）。进程退出时连接由 Bun 运行时自动回收，无需显式关闭。若未来需要显式关闭，应新增 `closeMysql()` 同时重置 `rawConnection` 和 `db`。

---

### 文件：`src/agent/tools/mysql.ts`

#### 依赖

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import { getMysqlConnection } from '@/services/db/drizzle.ts'
```

#### 常量

```typescript
const MAX_ROWS = 500
```

#### mysqlListTables（自省工具 — 表目录）

```typescript
export const createMysqlListTables = (envOverride?: string) =>
  tool({
    description: '列出当前数据库中所有表，包括表注释和预估行数。用于了解数据库结构。',
    inputSchema: z.object({}),
    execute: async () => {
      const conn = await getMysqlConnection(envOverride)
      const [rows] = await conn.query(`
        SELECT TABLE_NAME as name, TABLE_COMMENT as comment, TABLE_ROWS as estimatedRows
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME
      `)
      return { tables: rows }
    },
  })
```

- **无参数**：LLM 零成本调用
- 用 `INFORMATION_SCHEMA` 而非 `SHOW TABLES`，同时获取注释和行数
- `TABLE_ROWS` 是 InnoDB 预估值，用于 LLM 判断数据量级

#### mysqlDescribeTable（自省工具 — 表结构 + 样本行）

```typescript
export const createMysqlDescribeTable = (envOverride?: string) =>
  tool({
    description: '查看指定 MySQL 表的列定义（含注释）、索引和样本数据。用于理解表结构和数据格式。',
    inputSchema: z.object({
      table: z.string().describe('表名'),
    }),
    execute: async ({ table }) => {
      const conn = await getMysqlConnection(envOverride)

      // 安全校验：表名格式白名单 + 存在性验证（双重防护，不可移除任一层）
      if (!/^[a-zA-Z0-9_]+$/.test(table)) {
        return { error: `表名 '${table}' 包含非法字符` }
      }
      const [tableCheck] = await conn.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table],
      )
      if (!Array.isArray(tableCheck) || tableCheck.length === 0) {
        return { error: `表 '${table}' 不存在` }
      }

      // 列信息（含注释——业务语义的关键来源）
      const [columns] = await conn.query(`
        SELECT COLUMN_NAME as name, COLUMN_TYPE as type, IS_NULLABLE as nullable,
               COLUMN_DEFAULT as defaultValue, COLUMN_COMMENT as comment
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [table])

      // 索引信息
      const [indexes] = await conn.query(`SHOW INDEX FROM \`${table}\``)

      // 样本行（帮助 LLM 理解数据格式和实际取值）
      const [sampleRows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT 3`)

      return { columns, indexes, sampleRows }
    },
  })
```

- **表名安全**：双重防护——先用正则 `/^[a-zA-Z0-9_]+$/` 过滤非法字符，再查 `INFORMATION_SCHEMA.TABLES` 验证表名存在。两层校验缺一不可，后续重构不得移除
- **COLUMN_COMMENT** 是核心：如果 DB 中写了列注释（如 `status: 0=待支付 1=已支付`），LLM 可直接理解业务语义
- **样本行**（LIMIT 3）：对齐 LangChain 做法，帮助 LLM 理解日期格式、ID 格式、枚举值等
- 列查询使用参数化 `?`；`SHOW INDEX` 和 `SELECT *` 无法参数化，使用反引号包裹表名，但前置校验已确保表名安全

#### mysqlQuery（读工具）

```typescript
export const createMysqlQuery = (envOverride?: string) =>
  tool({
    description: '执行 MySQL 查询语句（SELECT 等只读操作）。返回查询结果行。结果超过 500 行时自动截断。',
    inputSchema: z.object({
      sql: z.string().describe('要执行的 SQL 查询语句'),
    }),
    execute: async ({ sql }) => {
      const conn = await getMysqlConnection(envOverride)

      // 只允许只读语句
      const readOnlyPrefixes = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH']
      const trimmed = sql.trimStart().toUpperCase()
      if (!readOnlyPrefixes.some(p => trimmed.startsWith(p))) {
        return { error: '此工具仅支持只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN）。写操作请使用 mysqlExecute。' }
      }

      const [rows] = await conn.query(sql)
      if (Array.isArray(rows) && rows.length > MAX_ROWS) {
        return {
          rows: rows.slice(0, MAX_ROWS),
          rowCount: MAX_ROWS,
          truncated: true,
          totalCount: rows.length,
          message: `结果已截断，共 ${rows.length} 行，仅返回前 ${MAX_ROWS} 行。请添加 WHERE/LIMIT 条件缩小范围。`,
        }
      }
      return { rows, rowCount: Array.isArray(rows) ? rows.length : 0 }
    },
  })
```

- **无 needsApproval**：读操作自动执行
- **返回值**：`{ rows, rowCount }` 方便 LLM 理解结果；超限时附加 `truncated`、`totalCount`、`message`
- **SQL 白名单**：前缀检查拦截非只读语句，配合 `mysqlExecute`（needsApproval）确保写操作必须经用户确认。已知限制：`WITH` (CTE) 后可跟写操作（如 `WITH cte AS (...) DELETE FROM ...`，MySQL 8.0+ 合法），但个人工具场景下 LLM 不会生成这种攻击性 SQL，接受此风险

#### mysqlExecute（写工具）

```typescript
export const createMysqlExecute = (envOverride?: string) =>
  tool({
    description: '执行 MySQL 写操作（INSERT/UPDATE/DELETE/DDL 等）。需要用户确认后执行。',
    inputSchema: z.object({
      sql: z.string().describe('要执行的 SQL 语句'),
    }),
    needsApproval: true,
    execute: async ({ sql }) => {
      const conn = await getMysqlConnection(envOverride)
      const [result] = await conn.execute(sql)
      return { result }
    },
  })
```

- **needsApproval: true**：写操作暂停等待用户确认
- 使用 `conn.execute()` 而非 `conn.query()`：execute 更适合写操作（返回 ResultSetHeader）

---

### 文件：`src/agent/tools/mongo.ts`

#### 依赖

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import mongoose from 'mongoose'
import { connectMongo } from '@/services/db/mongoose.ts'
```

#### 常量与辅助函数

```typescript
const MAX_DOCS = 500

const getCollection = async (collectionName: string, envOverride?: string) => {
  await connectMongo(envOverride)
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB 连接未就绪')
  return db.collection(collectionName)
}

// 递归提取嵌套文档的字段名和类型
// 通过 `_bsontype` 属性识别 MongoDB BSON 类型（ObjectId、Decimal128、Binary 等），帮助 LLM 更精确理解字段类型
const extractFields = (
  obj: Record<string, unknown>,
  prefix: string,
  fieldMap: Map<string, Set<string>>,
) => {
  for (const [key, value] of Object.entries(obj)) {
    const fieldName = prefix ? `${prefix}.${key}` : key
    const type = value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value === 'object' && value instanceof Date
          ? 'date'
          : typeof value === 'object' && value !== null && '_bsontype' in value
            ? (value as { _bsontype: string })._bsontype.toLowerCase()  // ObjectId → 'objectid', Decimal128 → 'decimal128'
            : typeof value
    if (!fieldMap.has(fieldName)) fieldMap.set(fieldName, new Set())
    fieldMap.get(fieldName)!.add(type)
    // 递归处理嵌套对象（不递归数组元素）
    if (type === 'object' && value !== null) {
      extractFields(value as Record<string, unknown>, fieldName, fieldMap)
    }
  }
}
```

#### mongoListCollections（自省工具 — 集合目录）

```typescript
export const createMongoListCollections = (envOverride?: string) =>
  tool({
    description: '列出当前数据库中所有集合及其预估文档数。用于了解数据库结构。',
    inputSchema: z.object({}),
    execute: async () => {
      await connectMongo(envOverride)
      const db = mongoose.connection.db
      if (!db) throw new Error('MongoDB 连接未就绪')
      const collections = await db.listCollections().toArray()
      const result = await Promise.all(
        collections.map(async (c) => ({
          name: c.name,
          type: c.type,
          estimatedCount: await db.collection(c.name).estimatedDocumentCount(),
        })),
      )
      return { collections: result }
    },
  })
```

- **无参数**：LLM 零成本调用
- 包含 `type` 字段区分集合和视图
- `estimatedDocumentCount()` 比 `countDocuments()` 快（不扫描全集合）

#### mongoDescribeCollection（自省工具 — 采样推断结构）

```typescript
export const createMongoDescribeCollection = (envOverride?: string) =>
  tool({
    description: '通过采样推断 MongoDB 集合的字段结构，并返回样本文档。用于理解集合结构和数据格式。',
    inputSchema: z.object({
      collection: z.string().describe('集合名称'),
      sampleSize: z.number().default(5).describe('采样文档数'),
    }),
    execute: async ({ collection, sampleSize }) => {
      const coll = await getCollection(collection, envOverride)
      const sampleDocs = await coll
        .aggregate([{ $sample: { size: sampleSize } }])
        .toArray()

      // 从样本中推断字段 → 类型映射
      const fieldMap = new Map<string, Set<string>>()
      for (const doc of sampleDocs) {
        extractFields(doc as Record<string, unknown>, '', fieldMap)
      }

      const fields = [...fieldMap.entries()].map(([name, types]) => ({
        name,
        types: [...types],
      }))

      return { fields, sampleDocs }
    },
  })
```

- `$sample` 随机采样，避免只看最新/最旧的数据导致字段不全
- `extractFields` 递归提取嵌套字段（如 `address.city`），支持完整的文档结构发现
- 返回样本文档原文，帮助 LLM 理解真实数据格式
- MongoDB 无固定 schema，采样是唯一可靠的结构发现方式

#### mongoQuery（读工具）

```typescript
export const createMongoQuery = (envOverride?: string) =>
  tool({
    description: '查询 MongoDB 数据。支持 find/findOne/countDocuments 操作。',
    inputSchema: z.object({
      collection: z.string().describe('集合名称'),
      operation: z.enum(['find', 'findOne', 'countDocuments'])
        .describe('查询操作类型'),
      query: z.record(z.unknown()).default({}).describe('查询条件（JSON 对象）'),
      options: z.object({
        limit: z.number().optional().describe('返回数量限制（最大 500）'),
        skip: z.number().optional().describe('跳过数量'),
        sort: z.record(z.number()).optional().describe('排序条件'),
        projection: z.record(z.number()).optional().describe('字段投影'),
      }).optional().describe('查询选项'),
    }),
    execute: async ({ collection, operation, query, options }) => {
      const coll = await getCollection(collection, envOverride)

      switch (operation) {
        case 'find': {
          let cursor = coll.find(query)
          if (options?.projection) cursor = cursor.project(options.projection)
          if (options?.sort) cursor = cursor.sort(options.sort)
          if (options?.skip) cursor = cursor.skip(options.skip)
          // 兜底 limit：取用户指定值和 MAX_DOCS 中的较小值
          cursor = cursor.limit(Math.min(options?.limit ?? MAX_DOCS, MAX_DOCS))
          const docs = await cursor.toArray()
          return { docs, count: docs.length }
        }
        case 'findOne': {
          const doc = await coll.findOne(query, { projection: options?.projection })
          return { doc }
        }
        case 'countDocuments': {
          const count = await coll.countDocuments(query)
          return { count }
        }
      }
    },
  })
```

- **无 needsApproval**：读操作自动执行
- **find 兜底 limit**：`Math.min(options.limit ?? 500, 500)`，确保不超过 500 条
- **operation 不含 aggregate**：已拆分为独立工具

#### mongoAggregate（聚合管道工具）

```typescript
export const createMongoAggregate = (envOverride?: string) =>
  tool({
    description: '执行 MongoDB 聚合管道（aggregate pipeline）。结果超过 500 条时自动截断。',
    inputSchema: z.object({
      collection: z.string().describe('集合名称'),
      pipeline: z.array(z.record(z.unknown())).describe('聚合管道阶段数组'),
    }),
    execute: async ({ collection, pipeline }) => {
      const coll = await getCollection(collection, envOverride)

      // 检测写操作阶段（$out/$merge 会写入其他集合）
      const writeStages = ['$out', '$merge']
      const hasWriteStage = pipeline.some(stage =>
        Object.keys(stage).some(key => writeStages.includes(key))
      )
      if (hasWriteStage) {
        return { error: '聚合管道包含写操作阶段（$out/$merge），请使用 mongoExecute 执行写操作。' }
      }

      const docs = await coll.aggregate(pipeline as Document[]).toArray()
      if (docs.length > MAX_DOCS) {
        return {
          docs: docs.slice(0, MAX_DOCS),
          count: MAX_DOCS,
          truncated: true,
          totalCount: docs.length,
          message: `结果已截断，共 ${docs.length} 条，仅返回前 ${MAX_DOCS} 条。请在 pipeline 中添加 $limit 阶段。`,
        }
      }
      return { docs, count: docs.length }
    },
  })
```

- **独立工具**：`pipeline` 是数组类型，schema 清晰无歧义
- **结果截断**：超过 500 条时截断并提示添加 `$limit`
- **写阶段拦截**：`$out`/`$merge` 会写入集合，但 aggregate 工具无 `needsApproval`，因此在工具层直接拦截并提示使用 `mongoExecute`

#### mongoExecute（写工具）

```typescript
export const createMongoExecute = (envOverride?: string) =>
  tool({
    description: '执行 MongoDB 写操作。需要用户确认后执行。',
    inputSchema: z.object({
      collection: z.string().describe('集合名称'),
      operation: z.enum([
        'insertOne', 'insertMany',
        'updateOne', 'updateMany',
        'deleteOne', 'deleteMany',
        'replaceOne',
      ]).describe('写操作类型'),
      filter: z.record(z.unknown()).default({}).describe('过滤条件（update/delete 操作需要）'),
      data: z.unknown().optional().describe('写入数据（insert/update/replace 操作需要）'),
    }),
    needsApproval: true,
    execute: async ({ collection, operation, filter, data }) => {
      const coll = await getCollection(collection, envOverride)

      switch (operation) {
        case 'insertOne':
          return await coll.insertOne(data as Document)
        case 'insertMany':
          return await coll.insertMany(data as Document[])
        case 'updateOne':
          return await coll.updateOne(filter, data as Document)
        case 'updateMany':
          return await coll.updateMany(filter, data as Document)
        case 'deleteOne':
          return await coll.deleteOne(filter)
        case 'deleteMany':
          return await coll.deleteMany(filter)
        case 'replaceOne':
          return await coll.replaceOne(filter, data as Document)
      }
    },
  })
```

**设计决策**：
- `query` 和 `filter` 使用 `z.record(z.unknown())` 而非 `z.any()`——保留对象结构约束但允许任意键值
- find 操作通过兜底 limit 控制结果大小
- aggregate 独立工具，pipeline 参数类型为数组，语义清晰

---

### 文件：`src/agent/tools/http.ts`

#### 依赖

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import { ofetch } from 'ofetch'
```

#### 常量

```typescript
const MAX_RESPONSE_LENGTH = 50000  // 约 50KB 文本
```

#### httpRequest

```typescript
export const createHttpRequest = () =>
  tool({
    description: '发起 HTTP 请求。GET 请求自动执行，其他方法需要用户确认。',
    inputSchema: z.object({
      url: z.string().describe('完整的请求 URL'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET')
        .describe('HTTP 方法'),
      headers: z.record(z.string()).optional().describe('请求头'),
      body: z.unknown().optional().describe('请求体（JSON）'),
      timeout: z.number().default(10000).describe('超时毫秒数'),
    }),
    needsApproval: async ({ method }) => method !== 'GET',
    execute: async ({ url, method, headers, body, timeout }) => {
      const response = await ofetch(url, {
        method,
        headers,
        body: body as BodyInit | undefined,
        timeout,
      })
      const text = typeof response === 'string' ? response : JSON.stringify(response)
      if (text.length > MAX_RESPONSE_LENGTH) {
        return {
          data: text.slice(0, MAX_RESPONSE_LENGTH),
          truncated: true,
          totalLength: text.length,
          message: `响应已截断，原始长度 ${text.length} 字符，仅返回前 ${MAX_RESPONSE_LENGTH} 字符。`,
        }
      }
      return { data: response }
    },
  })
```

**设计决策**：
- **不使用 `createApiClient`**：Agent 需要访问任意 URL，不限于 config 中的 baseUrl
- **`needsApproval` 使用 async 函数**：根据 method 动态决定——GET 免确认，POST/PUT/PATCH/DELETE 需确认（AI SDK v6 源码确认支持）
- **错误处理**：ofetch 在非 2xx 响应时自动抛出 `FetchError`，AI SDK 会将错误信息传回 LLM
- **响应截断**：超过 50KB 的响应自动截断，与 DB 工具的结果截断策略对齐，防止打爆 LLM 上下文

---

### 文件：`src/agent/tools/index.ts`

聚合导出所有工具：

```typescript
import {
  createMysqlListTables,
  createMysqlDescribeTable,
  createMysqlQuery,
  createMysqlExecute,
} from './mysql.ts'
import {
  createMongoListCollections,
  createMongoDescribeCollection,
  createMongoQuery,
  createMongoAggregate,
  createMongoExecute,
} from './mongo.ts'
import { createHttpRequest } from './http.ts'

export const createAgentTools = (envOverride?: string) => ({
  // MySQL 自省
  mysqlListTables: createMysqlListTables(envOverride),
  mysqlDescribeTable: createMysqlDescribeTable(envOverride),
  // MySQL 操作
  mysqlQuery: createMysqlQuery(envOverride),
  mysqlExecute: createMysqlExecute(envOverride),
  // MongoDB 自省
  mongoListCollections: createMongoListCollections(envOverride),
  mongoDescribeCollection: createMongoDescribeCollection(envOverride),
  // MongoDB 操作
  mongoQuery: createMongoQuery(envOverride),
  mongoAggregate: createMongoAggregate(envOverride),
  mongoExecute: createMongoExecute(envOverride),
  // HTTP
  httpRequest: createHttpRequest(),
})
```

**设计决策**：
- 工厂函数模式 `createAgentTools(envOverride)`：将 envOverride 传递给各数据库工具，HTTP 工具不需要
- 返回扁平对象，key 即工具名，直接传给 `generateText({ tools })`
- 工具总数 10：4 MySQL + 5 MongoDB + 1 HTTP

---

### 文件：`src/agent/__tests__/tools.test.ts`

#### 测试策略

mock 数据库连接，验证工具 schema 和行为：

```
describe('agent tools', () => {
  describe('mysql 自省工具', () => {
    it('mysqlListTables 返回表列表（含注释和行数）')
    it('mysqlDescribeTable 返回列信息 + 索引 + 样本行')
    it('mysqlDescribeTable 对不存在的表返回错误')
  })

  describe('mysql 操作工具', () => {
    it('mysqlQuery 执行查询并返回结果')
    it('mysqlQuery 结果超过 500 行时截断')
    it('mysqlQuery 无 needsApproval')
    it('mysqlQuery 拒绝非只读语句（如 DROP TABLE）')
    it('mysqlExecute 有 needsApproval: true')
    it('mysqlExecute 执行写操作并返回结果')
  })

  describe('mongo 自省工具', () => {
    it('mongoListCollections 返回集合列表（含预估文档数）')
    it('mongoDescribeCollection 返回推断字段和样本文档')
    it('mongoDescribeCollection 正确提取嵌套字段')
    it('mongoDescribeCollection 识别 ObjectId 等 BSON 类型')
  })

  describe('mongo 操作工具', () => {
    it('mongoQuery find 操作返回文档列表')
    it('mongoQuery find 操作兜底 limit 500')
    it('mongoQuery findOne 操作返回单个文档')
    it('mongoQuery countDocuments 返回数量')
    it('mongoQuery 无 needsApproval')
    it('mongoAggregate 执行聚合管道并返回结果')
    it('mongoAggregate 结果超过 500 条时截断')
    it('mongoAggregate 拒绝包含 $out/$merge 的 pipeline')
    it('mongoAggregate 无 needsApproval')
    it('mongoExecute insertOne 调用正确')
    it('mongoExecute 有 needsApproval: true')
  })

  describe('http tool', () => {
    it('httpRequest GET 请求 needsApproval 返回 false')
    it('httpRequest POST 请求 needsApproval 返回 true')
    it('httpRequest 发起请求并返回响应')
    it('httpRequest 响应超过 50KB 时截断')
  })

  describe('createAgentTools', () => {
    it('返回包含所有 10 个工具的对象')
  })
})
```

#### Mock 注意事项

- **MySQL mock**：mock `getMysqlConnection` 返回 `{ query: vi.fn(), execute: vi.fn() }`，按不同 SQL 返回不同 mock 数据
- **MongoDB mock**：mock `connectMongo` + mock `mongoose.connection.db`（listCollections + collection 方法）
- **HTTP mock**：mock `ofetch` 直接返回模拟响应
- **needsApproval 测试**：AI SDK `tool()` 的 `needsApproval` 是工具定义的属性，可直接检查；函数形式需要调用验证
- **截断测试**：MySQL 和 mongoAggregate 需要 mock 返回超过 500 行/条的数据验证截断行为
- **嵌套字段测试**：mongoDescribeCollection 需要 mock 包含嵌套对象的样本文档验证 extractFields 递归提取

## 错误追踪

| 错误描述 | 尝试次数 | 解决方案 |
|----------|----------|----------|
| （暂无） | | |
