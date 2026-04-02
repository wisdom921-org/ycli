#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'
import { envCommand } from '@/commands/env.ts'

const main = defineCommand({
  meta: {
    name: 'ycli',
    version: '0.1.0',
    description: '个人 AI Agent',
  },
  args: {
    env: {
      type: 'string',
      description: '指定环境',
    },
  },
  async run({ args }) {
    // 无子命令时启动 Agent REPL
    const { startAgent } = await import('@/agent/index.ts')
    await startAgent(args.env)
  },
  subCommands: {
    env: envCommand,
  },
})

runMain(main)
