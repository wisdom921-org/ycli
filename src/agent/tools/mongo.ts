import * as p from '@clack/prompts'
import { tool } from 'ai'
import type { Document, Sort } from 'mongodb'
import mongoose from 'mongoose'
import { z } from 'zod'
import { connectMongo } from '@/services/db/mongoose.ts'
import logger from '@/utils/logger.ts'

const MAX_DOCS = 500

const getCollection = async (collectionName: string, envOverride?: string) => {
  await connectMongo(envOverride)
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB 连接未就绪')
  return db.collection(collectionName)
}

// 递归提取嵌套文档的字段名和类型
// 通过 `_bsontype` 属性识别 MongoDB BSON 类型（ObjectId、Decimal128、Binary 等）
export const extractFields = (
  obj: Record<string, unknown>,
  prefix: string,
  fieldMap: Map<string, Set<string>>,
) => {
  for (const [key, value] of Object.entries(obj)) {
    const fieldName = prefix ? `${prefix}.${key}` : key
    const type =
      value === null
        ? 'null'
        : Array.isArray(value)
          ? 'array'
          : typeof value === 'object' && value instanceof Date
            ? 'date'
            : typeof value === 'object' && value !== null && '_bsontype' in value
              ? (value as { _bsontype: string })._bsontype.toLowerCase()
              : typeof value
    if (!fieldMap.has(fieldName)) fieldMap.set(fieldName, new Set())
    fieldMap.get(fieldName)?.add(type)
    // 递归处理嵌套对象（不递归数组元素）
    if (type === 'object' && value !== null) {
      extractFields(value as Record<string, unknown>, fieldName, fieldMap)
    }
  }
}

/** 列出当前数据库所有集合（含预估文档数） */
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

/** 通过采样推断集合字段结构，返回样本文档 */
export const createMongoDescribeCollection = (envOverride?: string) =>
  tool({
    description:
      '通过采样推断 MongoDB 集合的字段结构，并返回样本文档。用于理解集合结构和数据格式。',
    inputSchema: z.object({
      collection: z.string().describe('集合名称'),
      sampleSize: z.number().default(5).describe('采样文档数'),
    }),
    execute: async ({ collection, sampleSize }) => {
      const coll = await getCollection(collection, envOverride)
      const sampleDocs = await coll.aggregate([{ $sample: { size: sampleSize } }]).toArray()

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

/** 查询 MongoDB 数据（find/findOne/countDocuments） */
export const createMongoQuery = (envOverride?: string) =>
  tool({
    description: '查询 MongoDB 数据。支持 find/findOne/countDocuments 操作。',
    inputSchema: z.object({
      collection: z.string().describe('集合名称'),
      operation: z.enum(['find', 'findOne', 'countDocuments']).describe('查询操作类型'),
      query: z.record(z.string(), z.unknown()).default({}).describe('查询条件（JSON 对象）'),
      options: z
        .object({
          limit: z.number().optional().describe('返回数量限制（最大 500）'),
          skip: z.number().optional().describe('跳过数量'),
          sort: z.record(z.string(), z.number()).optional().describe('排序条件'),
          projection: z.record(z.string(), z.number()).optional().describe('字段投影'),
        })
        .optional()
        .describe('查询选项'),
    }),
    execute: async ({ collection, operation, query, options }) => {
      const coll = await getCollection(collection, envOverride)

      switch (operation) {
        case 'find': {
          let cursor = coll.find(query)
          if (options?.projection) cursor = cursor.project(options.projection)
          if (options?.sort) cursor = cursor.sort(options.sort as unknown as Sort)
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

/** 执行 MongoDB 聚合管道，结果超过 500 条自动截断 */
export const createMongoAggregate = (envOverride?: string) =>
  tool({
    description: '执行 MongoDB 聚合管道（aggregate pipeline）。结果超过 500 条时自动截断。',
    inputSchema: z.object({
      collection: z.string().describe('集合名称'),
      pipeline: z.array(z.record(z.string(), z.unknown())).describe('聚合管道阶段数组'),
    }),
    execute: async ({ collection, pipeline }) => {
      const coll = await getCollection(collection, envOverride)

      // 拦截写操作阶段（$out/$merge 会写入其他集合）
      const writeStages = ['$out', '$merge']
      const hasWriteStage = pipeline.some((stage) =>
        Object.keys(stage).some((key) => writeStages.includes(key)),
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

/** 执行 MongoDB 写操作，execute 内部确认 */
export const createMongoExecute = (envOverride?: string) =>
  tool({
    description: '执行 MongoDB 写操作。执行前会请求用户确认。',
    inputSchema: z.object({
      collection: z.string().describe('集合名称'),
      operation: z
        .enum([
          'insertOne',
          'insertMany',
          'updateOne',
          'updateMany',
          'deleteOne',
          'deleteMany',
          'replaceOne',
        ])
        .describe('写操作类型'),
      filter: z
        .record(z.string(), z.unknown())
        .default({})
        .describe('过滤条件（update/delete 操作需要）'),
      data: z.unknown().optional().describe('写入数据（insert/update/replace 操作需要）'),
    }),
    execute: async ({ collection, operation, filter, data: rawData }) => {
      logger.info(`工具调用: mongoExecute (${operation})`)
      console.log(JSON.stringify({ collection, operation, filter, data: rawData }, null, 2))
      let confirmed = await p.confirm({ message: '是否执行此操作？' })
      if (p.isCancel(confirmed)) confirmed = false
      if (!confirmed) return { error: '用户已拒绝此操作' }

      // LLM 可能传 JSON 字符串而非对象，需要解析
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData

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
