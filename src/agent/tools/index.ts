import { createHttpRequest } from './http.ts'
import {
  createMongoAggregate,
  createMongoDescribeCollection,
  createMongoExecute,
  createMongoListCollections,
  createMongoQuery,
} from './mongo.ts'
import {
  createMysqlDescribeTable,
  createMysqlExecute,
  createMysqlListTables,
  createMysqlQuery,
} from './mysql.ts'

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
