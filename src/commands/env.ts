import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { ConfigSchema } from '@/config/env.ts'
import {
  envExists,
  getCurrentEnv,
  listEnvs,
  loadConfig,
  saveConfig,
  setCurrentEnv,
} from '@/config/index.ts'
import logger from '@/utils/logger.ts'

// ycli env init
const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: '交互式初始化配置',
  },
  async run() {
    p.intro('配置环境')

    const env = await p.select({
      message: '选择要配置的环境',
      options: [
        { value: 'dev', label: 'dev - 开发环境' },
        { value: 'prd', label: 'prd - 生产环境' },
      ],
    })

    if (p.isCancel(env)) {
      p.cancel('已取消')
      process.exit(0)
    }

    // MySQL 配置
    p.log.step('MySQL 配置')
    const mysql = await p.group(
      {
        host: () =>
          p.text({
            message: 'MySQL Host',
            defaultValue: 'localhost',
          }),
        port: () =>
          p.text({
            message: 'MySQL Port',
            defaultValue: '3306',
          }),
        user: () =>
          p.text({
            message: 'MySQL User',
            placeholder: 'root',
          }),
        password: () =>
          p.password({
            message: 'MySQL Password',
          }),
        database: () =>
          p.text({
            message: 'MySQL Database',
          }),
      },
      {
        onCancel: () => {
          p.cancel('已取消')
          process.exit(0)
        },
      },
    )

    // MongoDB 配置
    p.log.step('MongoDB 配置')
    const mongoUri = await p.text({
      message: 'MongoDB URI',
      placeholder: 'mongodb://localhost:27017/mydb',
    })

    if (p.isCancel(mongoUri)) {
      p.cancel('已取消')
      process.exit(0)
    }

    // HTTP 配置（可选）
    const configureHttp = await p.confirm({
      message: '是否配置 HTTP baseUrl?',
      initialValue: false,
    })

    let http: { baseUrl: string } | undefined
    if (configureHttp && !p.isCancel(configureHttp)) {
      const baseUrl = await p.text({
        message: 'HTTP Base URL',
        placeholder: 'https://api.example.com',
      })
      if (!p.isCancel(baseUrl)) {
        http = { baseUrl }
      }
    }

    // AI 配置（可选）
    const configureAi = await p.confirm({
      message: '是否配置 AI 助手?',
      initialValue: false,
    })

    let ai:
      | {
          provider: string
          model: string
          anthropicApiKey?: string
          openaiApiKey?: string
          ollamaBaseUrl?: string
        }
      | undefined

    if (configureAi && !p.isCancel(configureAi)) {
      p.log.step('AI 助手配置')

      const provider = await p.select({
        message: '选择 LLM 提供商',
        options: [
          { value: 'anthropic', label: 'Anthropic (Claude)' },
          { value: 'openai', label: 'OpenAI (GPT)' },
          { value: 'ollama', label: 'Ollama (本地模型)' },
        ],
      })
      if (p.isCancel(provider)) {
        p.cancel('已取消')
        process.exit(0)
      }

      if (provider === 'anthropic') {
        const apiKey = await p.password({ message: 'Anthropic API Key' })
        if (p.isCancel(apiKey)) {
          p.cancel('已取消')
          process.exit(0)
        }
        const model = await p.text({
          message: '模型 ID',
          defaultValue: 'claude-sonnet-4-20250514',
        })
        if (p.isCancel(model)) {
          p.cancel('已取消')
          process.exit(0)
        }
        ai = { provider: 'anthropic', model, anthropicApiKey: apiKey }
      } else if (provider === 'openai') {
        const apiKey = await p.password({ message: 'OpenAI API Key' })
        if (p.isCancel(apiKey)) {
          p.cancel('已取消')
          process.exit(0)
        }
        const model = await p.text({
          message: '模型 ID',
          defaultValue: 'gpt-4o',
        })
        if (p.isCancel(model)) {
          p.cancel('已取消')
          process.exit(0)
        }
        ai = { provider: 'openai', model, openaiApiKey: apiKey }
      } else {
        const ollamaBaseUrl = await p.text({
          message: 'Ollama 服务地址',
          defaultValue: 'http://localhost:11434',
        })
        if (p.isCancel(ollamaBaseUrl)) {
          p.cancel('已取消')
          process.exit(0)
        }
        const model = await p.text({
          message: '模型 ID',
          defaultValue: 'llama3',
        })
        if (p.isCancel(model)) {
          p.cancel('已取消')
          process.exit(0)
        }
        ai = { provider: 'ollama', model, ollamaBaseUrl }
      }
    }

    // 验证并保存配置
    const config = ConfigSchema.parse({
      mysql: { ...mysql, port: Number(mysql.port) },
      mongo: { uri: mongoUri },
      http,
      ai,
    })

    saveConfig(env, config)
    setCurrentEnv(env)

    p.outro(`配置已保存，当前环境: ${env}`)
  },
})

// ycli env use <env>
const useCommand = defineCommand({
  meta: {
    name: 'use',
    description: '切换当前环境',
  },
  args: {
    env: {
      type: 'positional',
      description: '环境名称',
      required: true,
    },
  },
  run({ args }) {
    const env = args.env
    if (!envExists(env)) {
      logger.error(`环境 ${env} 未配置，请先运行 ycli env init`)
      process.exit(1)
    }
    setCurrentEnv(env)
    logger.success(`已切换到环境: ${env}`)
  },
})

// ycli env list
const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: '列出所有已配置环境',
  },
  run() {
    const current = getCurrentEnv()
    const envs = listEnvs()

    if (envs.length === 0) {
      logger.info('暂无已配置的环境，请运行 ycli env init')
      return
    }

    logger.info('已配置的环境:')
    for (const env of envs) {
      const marker = env === current ? ' (当前)' : ''
      console.log(`  ${env}${marker}`)
    }
  },
})

// ycli env show
const showCommand = defineCommand({
  meta: {
    name: 'show',
    description: '显示当前环境配置',
  },
  args: {
    env: {
      type: 'string',
      description: '指定环境（默认当前环境）',
    },
  },
  run({ args }) {
    try {
      const config = loadConfig(args.env)
      const env = args.env || getCurrentEnv()
      logger.info(`环境 ${env} 的配置:`)
      // 隐藏敏感信息
      const safeConfig = {
        mysql: {
          ...config.mysql,
          password: '******',
        },
        mongo: {
          uri: config.mongo.uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'),
        },
        http: config.http,
        ai: config.ai
          ? {
              ...config.ai,
              anthropicApiKey: config.ai.anthropicApiKey ? '******' : undefined,
              openaiApiKey: config.ai.openaiApiKey ? '******' : undefined,
            }
          : undefined,
      }
      console.log(JSON.stringify(safeConfig, null, 2))
    } catch (error) {
      logger.error((error as Error).message)
      process.exit(1)
    }
  },
})

// ycli env 主命令
export const envCommand = defineCommand({
  meta: {
    name: 'env',
    description: '环境管理',
  },
  subCommands: {
    init: initCommand,
    use: useCommand,
    list: listCommand,
    show: showCommand,
  },
})
