import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}))

vi.mock('@/config/paths.ts', () => ({
  CONFIG_DIR: '/mock/.ycli',
}))

import { buildSystemPrompt } from '@/agent/system-prompt.ts'
import type { Config } from '@/config/env.ts'

const baseConfig: Config = {
  mysql: { host: 'localhost', port: 3306, user: 'root', password: 'pass', database: 'testdb' },
  mongo: { uri: 'mongodb://admin:secret@localhost:27017/testdb' },
}

const mockUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

describe('buildSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
  })

  it('包含环境名称', () => {
    const prompt = buildSystemPrompt(baseConfig, 'dev')
    expect(prompt).toContain('dev')
  })

  it('包含数据库连接信息', () => {
    const prompt = buildSystemPrompt(baseConfig, 'dev')
    expect(prompt).toContain('localhost:3306/testdb')
  })

  it('MongoDB URI 脱敏', () => {
    const prompt = buildSystemPrompt(baseConfig, 'dev')
    expect(prompt).not.toContain('admin:secret')
    expect(prompt).toContain('***:***')
  })

  it('无 HTTP 配置时不显示 HTTP 信息', () => {
    const prompt = buildSystemPrompt(baseConfig, 'dev')
    expect(prompt).not.toContain('HTTP Base URL')
  })

  it('有 HTTP 配置时显示 HTTP Base URL', () => {
    const config: Config = { ...baseConfig, http: { baseUrl: 'https://api.example.com' } }
    const prompt = buildSystemPrompt(config, 'dev')
    expect(prompt).toContain('https://api.example.com')
  })

  it('包含所有 10 个工具名称', () => {
    const prompt = buildSystemPrompt(baseConfig, 'dev')
    const toolNames = [
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
    ]
    for (const name of toolNames) {
      expect(prompt).toContain(name)
    }
  })

  it('包含 Look → Plan → Query 工作流引导', () => {
    const prompt = buildSystemPrompt(baseConfig, 'dev')
    expect(prompt).toContain('Look')
    expect(prompt).toContain('Plan')
    expect(prompt).toContain('Query')
    expect(prompt).toContain('绝对不要跳过此步骤')
  })

  it('注入 business-context.md 内容', () => {
    mockReadFileSync.mockReturnValue('这是业务上下文：订单表 orders 包含所有交易记录')
    const prompt = buildSystemPrompt(baseConfig, 'dev')
    expect(prompt).toContain('## 业务上下文')
    expect(prompt).toContain('这是业务上下文：订单表 orders 包含所有交易记录')
  })

  it('business-context.md 不存在时正常工作', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const prompt = buildSystemPrompt(baseConfig, 'dev')
    expect(prompt).not.toContain('## 业务上下文')
  })

  it('环境为 null 时显示未知', () => {
    const prompt = buildSystemPrompt(baseConfig, null)
    expect(prompt).toContain('未知')
  })
})

describe('generateText 集成', () => {
  it('纯文本回复', async () => {
    const { generateText } = await import('ai')
    const { MockLanguageModelV3 } = await import('ai/test')

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: 'text' as const, text: '你好！' }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: mockUsage,
        warnings: [],
      }),
    })

    const result = await generateText({ model, prompt: 'hi' })
    expect(result.text).toBe('你好！')
    expect(result.content.some((part) => part.type === 'text')).toBe(true)
  })

  it('工具调用自动执行（读工具）', async () => {
    const { generateText, tool, stepCountIs } = await import('ai')
    const { MockLanguageModelV3 } = await import('ai/test')
    const { z } = await import('zod')

    let callCount = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'tc1',
                toolName: 'readDb',
                input: JSON.stringify({ sql: 'SELECT 1' }),
              },
            ],
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage: mockUsage,
            warnings: [],
          }
        }
        return {
          content: [{ type: 'text' as const, text: '查询结果: 1' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: mockUsage,
          warnings: [],
        }
      },
    })

    const executeFn = vi.fn().mockResolvedValue({ rows: [{ value: 1 }] })
    const tools = {
      readDb: tool({
        description: 'read from db',
        inputSchema: z.object({ sql: z.string() }),
        execute: executeFn,
      }),
    }

    const result = await generateText({ model, prompt: 'query', tools, stopWhen: stepCountIs(5) })
    expect(executeFn).toHaveBeenCalledWith({ sql: 'SELECT 1' }, expect.anything())
    expect(result.text).toBe('查询结果: 1')
  })

  it('写工具产生 approval request', async () => {
    const { generateText, tool, stepCountIs } = await import('ai')
    const { MockLanguageModelV3 } = await import('ai/test')
    const { z } = await import('zod')

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'tc1',
            toolName: 'writeDb',
            input: JSON.stringify({ sql: 'DELETE FROM t' }),
          },
        ],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: mockUsage,
        warnings: [],
      }),
    })

    const tools = {
      writeDb: tool({
        description: 'write to db',
        inputSchema: z.object({ sql: z.string() }),
        needsApproval: true,
        execute: async () => ({ result: 'ok' }),
      }),
    }

    const result = await generateText({ model, prompt: 'delete', tools, stopWhen: stepCountIs(1) })
    const approvalReqs = result.content.filter((c) => c.type === 'tool-approval-request')
    expect(approvalReqs.length).toBeGreaterThan(0)
    expect(approvalReqs[0]?.toolCall.toolName).toBe('writeDb')
  })

  it('approval 拒绝后模型收到拒绝信息', async () => {
    const { generateText, tool, stepCountIs } = await import('ai')
    const { MockLanguageModelV3 } = await import('ai/test')
    const { z } = await import('zod')

    let callCount = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++
        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'tc1',
                toolName: 'writeDb',
                input: JSON.stringify({ sql: 'DELETE FROM t' }),
              },
            ],
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage: mockUsage,
            warnings: [],
          }
        }
        return {
          content: [{ type: 'text' as const, text: '操作已取消' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: mockUsage,
          warnings: [],
        }
      },
    })

    const tools = {
      writeDb: tool({
        description: 'write to db',
        inputSchema: z.object({ sql: z.string() }),
        needsApproval: true,
        execute: async () => ({ result: 'ok' }),
      }),
    }

    // 第一次调用：获取 approval 请求
    const result1 = await generateText({ model, prompt: 'delete', tools, stopWhen: stepCountIs(1) })
    const approvalReqs = result1.content.filter((c) => c.type === 'tool-approval-request')
    expect(approvalReqs.length).toBeGreaterThan(0)

    // 构造拒绝响应
    const approvalResponses = approvalReqs.map((req) => ({
      type: 'tool-approval-response' as const,
      approvalId: req.approvalId,
      approved: false,
      reason: '用户已拒绝',
    }))

    // 第二次调用：带拒绝响应继续对话
    const result2 = await generateText({
      model,
      tools,
      messages: [
        ...result1.response.messages,
        { role: 'tool' as const, content: approvalResponses },
      ],
    })

    expect(result2.text).toBe('操作已取消')
  })
})
