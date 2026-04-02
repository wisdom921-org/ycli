import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @clack/prompts（工具内部确认交互）和 logger（避免测试输出干扰）
const { mockConfirm, mockIsCancel } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockIsCancel: vi.fn(() => false),
}))

vi.mock('@clack/prompts', () => ({
  confirm: mockConfirm,
  isCancel: mockIsCancel,
}))

vi.mock('@/utils/logger.ts', () => ({
  default: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warn: vi.fn() },
}))

// 不 mock AI SDK — generateText 走真实路径，仅模型用 MockLanguageModelV3
import type { ModelMessage } from 'ai'
import { tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import { runAgentLoop } from '@/agent/index.ts'

const mockUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

/** 构造纯文本响应 */
const textResponse = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: mockUsage,
  warnings: [],
})

/** 构造工具调用响应 */
const toolCallResponse = (
  toolName: string,
  input: Record<string, unknown>,
  toolCallId = 'tc1',
) => ({
  content: [
    {
      type: 'tool-call' as const,
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    },
  ],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: mockUsage,
  warnings: [],
})

describe('Agent 循环集成测试', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('纯文本对话：输出文本', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => textResponse('你好！'),
    })

    const messages: ModelMessage[] = [{ role: 'user', content: '你好' }]
    await runAgentLoop(model, 'test system', {}, messages)

    expect(consoleSpy).toHaveBeenCalledWith('你好！')
    expect(messages.length).toBeGreaterThan(1)
  })

  it('读工具调用→文本回复（SDK 多步自动执行）', async () => {
    let callCount = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++
        if (callCount === 1) return toolCallResponse('readDb', { sql: 'SELECT 1' })
        return textResponse('查询结果: 1')
      },
    })

    const executeFn = vi.fn().mockResolvedValue({ rows: [{ value: 1 }] })
    const tools = {
      readDb: tool({
        description: '只读查询',
        inputSchema: z.object({ sql: z.string() }),
        execute: executeFn,
      }),
    }

    const messages: ModelMessage[] = [{ role: 'user', content: '查一下' }]
    await runAgentLoop(model, 'test', tools, messages)

    expect(executeFn).toHaveBeenCalledWith({ sql: 'SELECT 1' }, expect.anything())
    expect(consoleSpy).toHaveBeenCalledWith('查询结果: 1')
  })

  it('连续多步工具调用', async () => {
    let callCount = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++
        if (callCount === 1) return toolCallResponse('readDb', { sql: 'SELECT 1' }, 'tc1')
        if (callCount === 2) return toolCallResponse('readDb', { sql: 'SELECT 2' }, 'tc2')
        return textResponse('两次查询完成')
      },
    })

    const executeFn = vi.fn().mockResolvedValue({ rows: [] })
    const tools = {
      readDb: tool({
        description: '只读查询',
        inputSchema: z.object({ sql: z.string() }),
        execute: executeFn,
      }),
    }

    const messages: ModelMessage[] = [{ role: 'user', content: '两次查询' }]
    await runAgentLoop(model, 'test', tools, messages)

    expect(executeFn).toHaveBeenCalledTimes(2)
    expect(consoleSpy).toHaveBeenCalledWith('两次查询完成')
  })

  it('写工具确认通过→执行→返回文本', async () => {
    let callCount = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++
        if (callCount === 1) return toolCallResponse('writeDb', { sql: 'DELETE FROM t' })
        return textResponse('删除完成')
      },
    })

    // 确认逻辑在 execute 内部，mock confirm 返回 true
    mockConfirm.mockResolvedValue(true)

    const executeFn = vi.fn(async (_args: { sql: string }) => {
      // 模拟工具内部确认逻辑
      const p = await import('@clack/prompts')
      const confirmed = await p.confirm({ message: '确认？' })
      if (!confirmed) return { error: '用户已拒绝' }
      return { affected: 1 }
    })

    const tools = {
      writeDb: tool({
        description: '写操作',
        inputSchema: z.object({ sql: z.string() }),
        execute: executeFn,
      }),
    }

    const messages: ModelMessage[] = [{ role: 'user', content: '删除' }]
    await runAgentLoop(model, 'test', tools, messages)

    expect(mockConfirm).toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith('删除完成')
  })

  it('写工具确认拒绝→返回拒绝结果→模型响应', async () => {
    let callCount = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++
        if (callCount === 1) return toolCallResponse('writeDb', { sql: 'DELETE FROM t' })
        return textResponse('操作已取消')
      },
    })

    mockConfirm.mockResolvedValue(false)

    const executeFn = vi.fn(async () => {
      const p = await import('@clack/prompts')
      const confirmed = await p.confirm({ message: '确认？' })
      if (!confirmed) return { error: '用户已拒绝' }
      return { affected: 1 }
    })

    const tools = {
      writeDb: tool({
        description: '写操作',
        inputSchema: z.object({ sql: z.string() }),
        execute: executeFn,
      }),
    }

    const messages: ModelMessage[] = [{ role: 'user', content: '删除' }]
    await runAgentLoop(model, 'test', tools, messages)

    expect(mockConfirm).toHaveBeenCalled()
    // execute 被调用了（确认逻辑在 execute 内部），但返回拒绝结果
    expect(executeFn).toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith('操作已取消')
  })

  it('messages 历史正确累积', async () => {
    let callCount = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++
        if (callCount === 1) return toolCallResponse('readDb', { sql: 'SELECT 1' })
        return textResponse('完成')
      },
    })

    const tools = {
      readDb: tool({
        description: '只读查询',
        inputSchema: z.object({ sql: z.string() }),
        execute: async () => ({ rows: [{ value: 1 }] }),
      }),
    }

    const messages: ModelMessage[] = [{ role: 'user', content: '查一下' }]
    await runAgentLoop(model, 'test', tools, messages)

    // 只保留 user + assistant 最终文本（中间 tool 消息不入历史）
    expect(messages.some((m) => m.role === 'user')).toBe(true)
    expect(messages.some((m) => m.role === 'assistant')).toBe(true)
    expect(messages.length).toBe(2)
  })
})
