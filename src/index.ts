#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'
import { envCommand } from '@/commands/env.ts'

const subCommands = {
  env: envCommand,
}

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
    // citty 匹配子命令后仍会调用父命令的 run，需要手动跳过
    const firstArg = process.argv[2]
    if (firstArg && firstArg in subCommands) return

    // 无子命令时启动 Agent REPL
    const { startAgent } = await import('@/agent/index.ts')
    await startAgent(args.env)
  },
  subCommands,
})

runMain(main)
