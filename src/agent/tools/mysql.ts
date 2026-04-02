import * as p from '@clack/prompts'
import { tool } from 'ai'
import { z } from 'zod'
import { getMysqlConnection } from '@/services/db/drizzle.ts'
import logger from '@/utils/logger.ts'

const MAX_ROWS = 500

/** 列出当前数据库所有表（含注释和预估行数） */
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

/** 查看指定表的列定义（含注释）、索引和样本数据 */
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
        'SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table],
      )
      if (!Array.isArray(tableCheck) || tableCheck.length === 0) {
        return { error: `表 '${table}' 不存在` }
      }

      // 列信息（含注释——业务语义的关键来源）
      const [columns] = await conn.query(
        `SELECT COLUMN_NAME as name, COLUMN_TYPE as type, IS_NULLABLE as nullable,
                COLUMN_DEFAULT as defaultValue, COLUMN_COMMENT as comment
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [table],
      )

      // 索引信息
      const [indexes] = await conn.query(`SHOW INDEX FROM \`${table}\``)

      // 样本行（帮助 LLM 理解数据格式和实际取值）
      const [sampleRows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT 3`)

      return { columns, indexes, sampleRows }
    },
  })

/** 执行只读查询（SELECT 等），结果超过 500 行自动截断 */
export const createMysqlQuery = (envOverride?: string) =>
  tool({
    description:
      '执行 MySQL 查询语句（SELECT 等只读操作）。返回查询结果行。结果超过 500 行时自动截断。',
    inputSchema: z.object({
      sql: z.string().describe('要执行的 SQL 查询语句'),
    }),
    execute: async ({ sql }) => {
      const conn = await getMysqlConnection(envOverride)

      // 只允许只读语句
      const readOnlyPrefixes = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH']
      const trimmed = sql.trimStart().toUpperCase()
      if (!readOnlyPrefixes.some((p) => trimmed.startsWith(p))) {
        return {
          error:
            '此工具仅支持只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN）。写操作请使用 mysqlExecute。',
        }
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

/** 执行写操作（INSERT/UPDATE/DELETE/DDL），execute 内部确认 */
export const createMysqlExecute = (envOverride?: string) =>
  tool({
    description: '执行 MySQL 写操作（INSERT/UPDATE/DELETE/DDL 等）。执行前会请求用户确认。',
    inputSchema: z.object({
      sql: z.string().describe('要执行的 SQL 语句'),
    }),
    execute: async ({ sql }) => {
      logger.info('工具调用: mysqlExecute')
      console.log(sql)
      let confirmed = await p.confirm({ message: '是否执行此 SQL？' })
      if (p.isCancel(confirmed)) confirmed = false
      if (!confirmed) return { error: '用户已拒绝此操作' }

      const conn = await getMysqlConnection(envOverride)
      const [result] = await conn.execute(sql)
      return { result }
    },
  })
