import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { loadConfig } from '@/config/index.ts'

let db: MySql2Database | null = null
let rawConnection: mysql.Connection | null = null

export const getDb = async (envOverride?: string) => {
  if (db) return db

  const config = loadConfig(envOverride)
  rawConnection = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
  })

  db = drizzle(rawConnection)
  return db
}

// 暴露 raw connection 供 Agent 工具执行 raw SQL
// 与 getDb() 共享同一底层连接，外部禁止单独关闭 rawConnection
export const getMysqlConnection = async (envOverride?: string) => {
  if (rawConnection) return rawConnection
  await getDb(envOverride)
  if (!rawConnection) throw new Error('MySQL 连接初始化失败')
  return rawConnection
}
