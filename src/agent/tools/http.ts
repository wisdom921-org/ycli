import * as p from '@clack/prompts'
import { tool } from 'ai'
import { ofetch } from 'ofetch'
import { z } from 'zod'
import logger from '@/utils/logger.ts'

const MAX_RESPONSE_LENGTH = 50000

/** 发起 HTTP 请求，GET 免确认，其他方法需用户确认 */
export const createHttpRequest = () =>
  tool({
    description: '发起 HTTP 请求。GET 请求自动执行，其他方法需要用户确认。',
    inputSchema: z.object({
      url: z.string().describe('完整的请求 URL'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
        .default('GET')
        .describe('HTTP 方法'),
      headers: z.record(z.string(), z.string()).optional().describe('请求头'),
      body: z.unknown().optional().describe('请求体（JSON）'),
      timeout: z.number().default(10000).describe('超时毫秒数'),
    }),
    execute: async ({ url, method, headers, body, timeout }) => {
      // 非 GET 请求需用户确认
      if (method !== 'GET') {
        logger.info(`工具调用: httpRequest (${method})`)
        console.log(JSON.stringify({ url, method, headers, body }, null, 2))
        let confirmed = await p.confirm({ message: '是否执行此请求？' })
        if (p.isCancel(confirmed)) confirmed = false
        if (!confirmed) return { error: '用户已拒绝此操作' }
      }
      // LLM 可能传 JSON 字符串而非对象，需要解析
      const parsedBody = typeof body === 'string' ? JSON.parse(body) : body
      const response = await ofetch(url, {
        method,
        headers,
        body: parsedBody as Record<string, unknown> | undefined,
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
