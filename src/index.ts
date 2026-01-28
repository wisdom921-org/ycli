#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'
import { envCommand } from '@/commands/env.ts'
import { exampleCommand } from '@/commands/example.ts'

const main = defineCommand({
  meta: {
    name: 'ycli',
    version: '0.1.0',
    description: '个人 CLI 工具集',
  },
  subCommands: {
    env: envCommand,
    example: exampleCommand,
  },
})

runMain(main)
