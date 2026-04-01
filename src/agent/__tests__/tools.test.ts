import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted 确保 mock 变量在 vi.mock 提升后可用
const {
  mockQuery,
  mockExecute,
  mockFind,
  mockFindOne,
  mockCountDocuments,
  mockAggregate,
  mockInsertOne,
  mockEstimatedDocumentCount,
  mockListCollections,
  mockCollection,
  mockOfetch,
} = vi.hoisted(() => {
  const mockFind = vi.fn()
  const mockFindOne = vi.fn()
  const mockCountDocuments = vi.fn()
  const mockAggregate = vi.fn()
  const mockInsertOne = vi.fn()
  const mockInsertMany = vi.fn()
  const mockUpdateOne = vi.fn()
  const mockUpdateMany = vi.fn()
  const mockDeleteOne = vi.fn()
  const mockDeleteMany = vi.fn()
  const mockReplaceOne = vi.fn()
  const mockEstimatedDocumentCount = vi.fn()
  const mockListCollections = vi.fn()

  return {
    mockQuery: vi.fn(),
    mockExecute: vi.fn(),
    mockFind,
    mockFindOne,
    mockCountDocuments,
    mockAggregate,
    mockInsertOne,
    mockInsertMany,
    mockUpdateOne,
    mockUpdateMany,
    mockDeleteOne,
    mockDeleteMany,
    mockReplaceOne,
    mockEstimatedDocumentCount,
    mockListCollections,
    mockCollection: vi.fn(() => ({
      find: mockFind,
      findOne: mockFindOne,
      countDocuments: mockCountDocuments,
      aggregate: mockAggregate,
      insertOne: mockInsertOne,
      insertMany: mockInsertMany,
      updateOne: mockUpdateOne,
      updateMany: mockUpdateMany,
      deleteOne: mockDeleteOne,
      deleteMany: mockDeleteMany,
      replaceOne: mockReplaceOne,
      estimatedDocumentCount: mockEstimatedDocumentCount,
    })),
    mockOfetch: vi.fn(),
  }
})

vi.mock('@/services/db/drizzle.ts', () => ({
  getMysqlConnection: vi.fn(async () => ({ query: mockQuery, execute: mockExecute })),
}))

vi.mock('@/services/db/mongoose.ts', () => ({
  connectMongo: vi.fn(async () => {}),
}))

vi.mock('mongoose', () => ({
  default: {
    connection: {
      db: {
        collection: mockCollection,
        listCollections: mockListCollections,
      },
    },
  },
}))

vi.mock('ofetch', () => ({
  ofetch: (...args: unknown[]) => mockOfetch(...args),
}))

import { createHttpRequest } from '../tools/http'
import { createAgentTools } from '../tools/index'
import {
  createMongoAggregate,
  createMongoDescribeCollection,
  createMongoExecute,
  createMongoListCollections,
  createMongoQuery,
  extractFields,
} from '../tools/mongo'
import {
  createMysqlDescribeTable,
  createMysqlExecute,
  createMysqlListTables,
  createMysqlQuery,
} from '../tools/mysql'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── MySQL 自省工具 ───

describe('mysql 自省工具', () => {
  it('mysqlListTables 返回表列表（含注释和行数）', async () => {
    const tables = [
      { name: 'users', comment: '用户表', estimatedRows: 100 },
      { name: 'orders', comment: '订单表', estimatedRows: 500 },
    ]
    mockQuery.mockResolvedValueOnce([tables])

    const tool = createMysqlListTables()
    const result = await tool.execute?.({}, { toolCallId: 'test', messages: [] })
    expect(result).toEqual({ tables })
  })

  it('mysqlDescribeTable 返回列信息 + 索引 + 样本行', async () => {
    const columns = [
      { name: 'id', type: 'int', nullable: 'NO', defaultValue: null, comment: '主键' },
    ]
    const indexes = [{ Table: 'users', Key_name: 'PRIMARY' }]
    const sampleRows = [{ id: 1, name: 'test' }]

    // 表存在性检查
    mockQuery.mockResolvedValueOnce([[{ 1: 1 }]])
    // 列信息
    mockQuery.mockResolvedValueOnce([columns])
    // 索引
    mockQuery.mockResolvedValueOnce([indexes])
    // 样本行
    mockQuery.mockResolvedValueOnce([sampleRows])

    const tool = createMysqlDescribeTable()
    const result = await tool.execute?.({ table: 'users' }, { toolCallId: 'test', messages: [] })
    expect(result).toEqual({ columns, indexes, sampleRows })
  })

  it('mysqlDescribeTable 对不存在的表返回错误', async () => {
    mockQuery.mockResolvedValueOnce([[]])

    const tool = createMysqlDescribeTable()
    const result = await tool.execute?.(
      { table: 'nonexistent' },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toEqual({ error: "表 'nonexistent' 不存在" })
  })

  it('mysqlDescribeTable 拒绝非法表名', async () => {
    const tool = createMysqlDescribeTable()
    const result = await tool.execute?.(
      { table: 'users; DROP TABLE--' },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('非法字符')
  })
})

// ─── MySQL 操作工具 ───

describe('mysql 操作工具', () => {
  it('mysqlQuery 执行查询并返回结果', async () => {
    const rows = [{ id: 1 }, { id: 2 }]
    mockQuery.mockResolvedValueOnce([rows])

    const tool = createMysqlQuery()
    const result = await tool.execute?.(
      { sql: 'SELECT * FROM users' },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toEqual({ rows, rowCount: 2 })
  })

  it('mysqlQuery 结果超过 500 行时截断', async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ id: i }))
    mockQuery.mockResolvedValueOnce([rows])

    const tool = createMysqlQuery()
    const result = await tool.execute?.(
      { sql: 'SELECT * FROM big_table' },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toHaveProperty('truncated', true)
    expect(result).toHaveProperty('totalCount', 600)
    expect((result as { rows: unknown[] }).rows).toHaveLength(500)
  })

  it('mysqlQuery 拒绝非只读语句', async () => {
    const tool = createMysqlQuery()
    const result = await tool.execute?.(
      { sql: 'DROP TABLE users' },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('只读查询')
  })

  it('mysqlExecute 有 needsApproval: true', () => {
    const tool = createMysqlExecute()
    expect(tool.needsApproval).toBe(true)
  })

  it('mysqlExecute 执行写操作并返回结果', async () => {
    const execResult = { affectedRows: 1, insertId: 10 }
    mockExecute.mockResolvedValueOnce([execResult])

    const tool = createMysqlExecute()
    const result = await tool.execute?.(
      { sql: 'INSERT INTO users (name) VALUES ("test")' },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toEqual({ result: execResult })
  })
})

// ─── MongoDB 自省工具 ───

describe('mongo 自省工具', () => {
  it('mongoListCollections 返回集合列表（含预估文档数）', async () => {
    mockListCollections.mockReturnValueOnce({
      toArray: async () => [
        { name: 'users', type: 'collection' },
        { name: 'logs', type: 'collection' },
      ],
    })
    mockEstimatedDocumentCount.mockResolvedValue(42)

    const tool = createMongoListCollections()
    const result = (await tool.execute?.({}, { toolCallId: 'test', messages: [] })) as {
      collections: { name: string; type: string; estimatedCount: number }[]
    }
    expect(result.collections).toHaveLength(2)
    expect(result.collections[0]).toEqual({ name: 'users', type: 'collection', estimatedCount: 42 })
  })

  it('mongoDescribeCollection 返回推断字段和样本文档', async () => {
    const sampleDocs = [
      { _id: 'abc', name: 'test', age: 25 },
      { _id: 'def', name: 'test2', age: 30, email: 'a@b.com' },
    ]
    mockAggregate.mockReturnValueOnce({ toArray: async () => sampleDocs })

    const tool = createMongoDescribeCollection()
    const result = (await tool.execute?.(
      { collection: 'users', sampleSize: 5 },
      { toolCallId: 'test', messages: [] },
    )) as { fields: { name: string; types: string[] }[]; sampleDocs: unknown[] }
    expect(result.sampleDocs).toEqual(sampleDocs)
    expect(result.fields.find((f) => f.name === 'name')).toBeDefined()
  })

  it('mongoDescribeCollection 正确提取嵌套字段', () => {
    const fieldMap = new Map<string, Set<string>>()
    extractFields({ address: { city: 'Beijing', zip: 100000 } }, '', fieldMap)
    expect(fieldMap.has('address')).toBe(true)
    expect(fieldMap.has('address.city')).toBe(true)
    expect(fieldMap.has('address.zip')).toBe(true)
  })

  it('mongoDescribeCollection 识别 ObjectId 等 BSON 类型', () => {
    const fieldMap = new Map<string, Set<string>>()
    extractFields({ _id: { _bsontype: 'ObjectId', id: Buffer.from('test') } }, '', fieldMap)
    expect([...(fieldMap.get('_id') ?? [])]).toContain('objectid')
  })
})

// ─── MongoDB 操作工具 ───

describe('mongo 操作工具', () => {
  it('mongoQuery find 操作返回文档列表', async () => {
    const docs = [
      { _id: '1', name: 'a' },
      { _id: '2', name: 'b' },
    ]
    const mockCursor = {
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValueOnce(docs),
    }
    mockFind.mockReturnValueOnce(mockCursor)

    const tool = createMongoQuery()
    const result = await tool.execute?.(
      { collection: 'users', operation: 'find', query: {} },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toEqual({ docs, count: 2 })
  })

  it('mongoQuery find 操作兜底 limit 500', async () => {
    const mockCursor = {
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValueOnce([]),
    }
    mockFind.mockReturnValueOnce(mockCursor)

    const tool = createMongoQuery()
    await tool.execute?.(
      { collection: 'users', operation: 'find', query: {}, options: { limit: 1000 } },
      { toolCallId: 'test', messages: [] },
    )
    // 应该用 Math.min(1000, 500) = 500
    expect(mockCursor.limit).toHaveBeenCalledWith(500)
  })

  it('mongoQuery findOne 操作返回单个文档', async () => {
    const doc = { _id: '1', name: 'test' }
    mockFindOne.mockResolvedValueOnce(doc)

    const tool = createMongoQuery()
    const result = await tool.execute?.(
      { collection: 'users', operation: 'findOne', query: { _id: '1' } },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toEqual({ doc })
  })

  it('mongoQuery countDocuments 返回数量', async () => {
    mockCountDocuments.mockResolvedValueOnce(42)

    const tool = createMongoQuery()
    const result = await tool.execute?.(
      { collection: 'users', operation: 'countDocuments', query: {} },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toEqual({ count: 42 })
  })

  it('mongoAggregate 执行聚合管道并返回结果', async () => {
    const docs = [{ _id: 'group1', count: 10 }]
    mockAggregate.mockReturnValueOnce({ toArray: async () => docs })

    const tool = createMongoAggregate()
    const result = await tool.execute?.(
      { collection: 'orders', pipeline: [{ $group: { _id: '$status', count: { $sum: 1 } } }] },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toEqual({ docs, count: 1 })
  })

  it('mongoAggregate 结果超过 500 条时截断', async () => {
    const docs = Array.from({ length: 600 }, (_, i) => ({ _id: i }))
    mockAggregate.mockReturnValueOnce({ toArray: async () => docs })

    const tool = createMongoAggregate()
    const result = await tool.execute?.(
      { collection: 'data', pipeline: [{ $match: {} }] },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toHaveProperty('truncated', true)
    expect(result).toHaveProperty('totalCount', 600)
    expect((result as { docs: unknown[] }).docs).toHaveLength(500)
  })

  it('mongoAggregate 拒绝包含 $out/$merge 的 pipeline', async () => {
    const tool = createMongoAggregate()
    const result = await tool.execute?.(
      { collection: 'data', pipeline: [{ $match: {} }, { $out: 'output_coll' }] },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('$out/$merge')
  })

  it('mongoExecute insertOne 调用正确', async () => {
    mockInsertOne.mockResolvedValueOnce({ insertedId: 'abc' })

    const tool = createMongoExecute()
    const result = await tool.execute?.(
      { collection: 'users', operation: 'insertOne', filter: {}, data: { name: 'test' } },
      { toolCallId: 'test', messages: [] },
    )
    expect(mockInsertOne).toHaveBeenCalledWith({ name: 'test' })
    expect(result).toEqual({ insertedId: 'abc' })
  })

  it('mongoExecute 有 needsApproval: true', () => {
    const tool = createMongoExecute()
    expect(tool.needsApproval).toBe(true)
  })
})

// ─── HTTP 工具 ───

describe('http tool', () => {
  it('httpRequest GET 请求 needsApproval 返回 false', async () => {
    const tool = createHttpRequest()
    // needsApproval 是 async 函数，传入参数验证
    const result = await (
      tool.needsApproval as (input: Record<string, unknown>) => Promise<boolean>
    )({
      method: 'GET',
      url: 'http://test.com',
      timeout: 10000,
    })
    expect(result).toBe(false)
  })

  it('httpRequest POST 请求 needsApproval 返回 true', async () => {
    const tool = createHttpRequest()
    const result = await (
      tool.needsApproval as (input: Record<string, unknown>) => Promise<boolean>
    )({
      method: 'POST',
      url: 'http://test.com',
      timeout: 10000,
    })
    expect(result).toBe(true)
  })

  it('httpRequest 发起请求并返回响应', async () => {
    const responseData = { id: 1, name: 'test' }
    mockOfetch.mockResolvedValueOnce(responseData)

    const tool = createHttpRequest()
    const result = await tool.execute?.(
      { url: 'http://api.test.com/data', method: 'GET', timeout: 10000 },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toEqual({ data: responseData })
    expect(mockOfetch).toHaveBeenCalledWith(
      'http://api.test.com/data',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('httpRequest 响应超过 50KB 时截断', async () => {
    const longResponse = 'x'.repeat(60000)
    mockOfetch.mockResolvedValueOnce(longResponse)

    const tool = createHttpRequest()
    const result = await tool.execute?.(
      { url: 'http://api.test.com/big', method: 'GET', timeout: 10000 },
      { toolCallId: 'test', messages: [] },
    )
    expect(result).toHaveProperty('truncated', true)
    expect(result).toHaveProperty('totalLength', 60000)
    expect((result as { data: string }).data).toHaveLength(50000)
  })
})

// ─── 聚合导出 ───

describe('createAgentTools', () => {
  it('返回包含所有 10 个工具的对象', () => {
    const tools = createAgentTools()
    const toolNames = Object.keys(tools)
    expect(toolNames).toHaveLength(10)
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'mysqlListTables',
        'mysqlDescribeTable',
        'mysqlQuery',
        'mysqlExecute',
        'mongoListCollections',
        'mongoDescribeCollection',
        'mongoQuery',
        'mongoAggregate',
        'mongoExecute',
        'httpRequest',
      ]),
    )
  })
})
