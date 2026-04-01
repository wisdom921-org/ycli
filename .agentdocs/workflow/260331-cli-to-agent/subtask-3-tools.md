# 子任务 3：工具层

## 交付物

- MySQL 工具：`mysqlQuery`（读，直接执行）+ `mysqlExecute`（写，needsApproval）
- MongoDB 工具：`mongoQuery`（读）+ `mongoExecute`（写，needsApproval）
- HTTP 工具：`httpRequest`（GET 免确认，其余 needsApproval）
- 聚合导出 `createAgentTools(envOverride?)`
- 单元测试通过

## TODO

- [ ] 修改 `src/services/db/drizzle.ts`（暴露 raw mysql2 connection）
- [ ] 新建 `src/agent/tools/mysql.ts`
- [ ] 新建 `src/agent/tools/mongo.ts`
- [ ] 新建 `src/agent/tools/http.ts`
- [ ] 新建 `src/agent/tools/index.ts`
- [ ] 新建测试 `src/agent/__tests__/tools.test.ts`
- [ ] lint + typecheck + test 验证

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

---

### 文件：`src/agent/tools/mysql.ts`

#### 依赖

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import { getMysqlConnection } from '@/services/db/drizzle.ts'
```

#### mysqlQuery（读工具）

```typescript
export const createMysqlQuery = (envOverride?: string) =>
  tool({
    description: '执行 MySQL 查询语句（SELECT 等只读操作）。返回查询结果行。',
    inputSchema: z.object({
      sql: z.string().describe('要执行的 SQL 查询语句'),
    }),
    execute: async ({ sql }) => {
      const conn = await getMysqlConnection(envOverride)
      const [rows] = await conn.query(sql)
      return { rows, rowCount: Array.isArray(rows) ? rows.length : 0 }
    },
  })
```

- **无 needsApproval**：读操作自动执行
- **返回值**：`{ rows, rowCount }` 方便 LLM 理解结果

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

#### 辅助：获取原生 MongoDB collection

```typescript
const getCollection = async (collectionName: string, envOverride?: string) => {
  await connectMongo(envOverride)
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB 连接未就绪')
  return db.collection(collectionName)
}
```

#### mongoQuery（读工具）

```typescript
export const createMongoQuery = (envOverride?: string) =>
  tool({
    description: '查询 MongoDB 数据。支持 find/findOne/countDocuments/aggregate 操作。',
    inputSchema: z.object({
      collection: z.string().describe('集合名称'),
      operation: z.enum(['find', 'findOne', 'countDocuments', 'aggregate'])
        .describe('查询操作类型'),
      query: z.record(z.unknown()).default({}).describe('查询条件（JSON 对象）'),
      options: z.object({
        limit: z.number().optional().describe('返回数量限制'),
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
          if (options?.limit) cursor = cursor.limit(options.limit)
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
        case 'aggregate': {
          // query 作为 pipeline 数组使用
          const docs = await coll.aggregate(query as unknown as Document[]).toArray()
          return { docs, count: docs.length }
        }
      }
    },
  })
```

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
- `aggregate` 操作将 query 直接作为 pipeline 传入，description 中说明即可
- find 操作默认不限制返回数量，由 LLM 在 options.limit 中指定

---

### 文件：`src/agent/tools/http.ts`

#### 依赖

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import { ofetch } from 'ofetch'
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
      return { data: response }
    },
  })
```

**设计决策**：
- **不使用 `createApiClient`**：Agent 需要访问任意 URL，不限于 config 中的 baseUrl
- **`needsApproval` 使用 async 函数**：根据 method 动态决定——GET 免确认，POST/PUT/PATCH/DELETE 需确认
- **错误处理**：ofetch 在非 2xx 响应时自动抛出 `FetchError`，AI SDK 会将错误信息传回 LLM

---

### 文件：`src/agent/tools/index.ts`

聚合导出所有工具：

```typescript
import { createMysqlQuery, createMysqlExecute } from './mysql.ts'
import { createMongoQuery, createMongoExecute } from './mongo.ts'
import { createHttpRequest } from './http.ts'

export const createAgentTools = (envOverride?: string) => ({
  mysqlQuery: createMysqlQuery(envOverride),
  mysqlExecute: createMysqlExecute(envOverride),
  mongoQuery: createMongoQuery(envOverride),
  mongoExecute: createMongoExecute(envOverride),
  httpRequest: createHttpRequest(),
})
```

**设计决策**：
- 工厂函数模式 `createAgentTools(envOverride)`：将 envOverride 传递给各数据库工具，HTTP 工具不需要
- 返回扁平对象，key 即工具名，直接传给 `generateText({ tools })`

---

### 文件：`src/agent/__tests__/tools.test.ts`

#### 测试策略

mock 数据库连接，验证工具 schema 和行为：

```
describe('agent tools', () => {
  describe('mysql tools', () => {
    beforeEach(() => {
      // vi.mock('@/services/db/drizzle.ts') mock getMysqlConnection
      // 返回 { query: vi.fn(), execute: vi.fn() }
    })

    it('mysqlQuery 执行查询并返回结果')
      - 调用 tool.execute({ sql: 'SELECT 1' })
      - 验证 conn.query 被调用
      - 验证返回 { rows, rowCount }

    it('mysqlQuery 无 needsApproval')
      - 验证 tool 定义中无 needsApproval 或 needsApproval 为 falsy

    it('mysqlExecute 有 needsApproval: true')
      - 验证 tool.needsApproval === true

    it('mysqlExecute 执行写操作并返回结果')
      - 调用 tool.execute({ sql: 'INSERT INTO ...' })
      - 验证 conn.execute 被调用
  })

  describe('mongo tools', () => {
    beforeEach(() => {
      // vi.mock('@/services/db/mongoose.ts') mock connectMongo
      // vi.mock mongoose.connection.db 返回 mock collection
    })

    it('mongoQuery find 操作返回文档列表')
    it('mongoQuery findOne 操作返回单个文档')
    it('mongoQuery countDocuments 返回数量')
    it('mongoQuery 无 needsApproval')
    it('mongoExecute insertOne 调用正确')
    it('mongoExecute 有 needsApproval: true')
  })

  describe('http tool', () => {
    beforeEach(() => {
      // vi.mock ofetch
    })

    it('httpRequest GET 请求 needsApproval 返回 false')
      - 调用 needsApproval({ method: 'GET', ... })
      - 验证返回 false

    it('httpRequest POST 请求 needsApproval 返回 true')
      - 调用 needsApproval({ method: 'POST', ... })
      - 验证返回 true

    it('httpRequest 发起请求并返回响应')
      - 调用 tool.execute({ url: '...', method: 'GET' })
      - 验证 ofetch 被调用
  })

  describe('createAgentTools', () => {
    it('返回包含所有工具的对象')
      - 验证返回对象包含 mysqlQuery, mysqlExecute, mongoQuery, mongoExecute, httpRequest
  })
})
```

#### Mock 注意事项

- **MySQL mock**：mock `getMysqlConnection` 返回 `{ query: vi.fn().mockResolvedValue([[{ id: 1 }], []]), execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) }`
- **MongoDB mock**：mock `connectMongo` + mock `mongoose.connection.db.collection()` 返回带有 find/insertOne 等方法的 mock 对象
- **HTTP mock**：mock `ofetch` 直接返回模拟响应
- **needsApproval 测试**：AI SDK `tool()` 的 `needsApproval` 是工具定义的属性，可直接检查；函数形式需要调用验证

## 错误追踪

| 错误描述 | 尝试次数 | 解决方案 |
|----------|----------|----------|
| （暂无） | | |
