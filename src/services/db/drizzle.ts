import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { loadConfig } from '@/config/index.ts'

let db: MySql2Database | null = null

export const getDb = async (envOverride?: string) => {
  if (db) return db

  const config = loadConfig(envOverride)
  const connection = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
  })

  db = drizzle(connection)
  return db
}
