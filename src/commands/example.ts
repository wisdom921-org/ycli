import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import logger from '@/utils/logger.ts'

// 示例命令，展示交互 UI 使用方式
export const exampleCommand = defineCommand({
  meta: {
    name: 'example',
    description: '示例命令，展示交互 UI',
  },
  args: {
    env: {
      type: 'string',
      description: '指定环境',
    },
  },
  async run({ args }) {
    p.intro('示例命令')

    // 文本输入
    const name = await p.text({
      message: '请输入你的名字',
      placeholder: 'Your name',
      validate: (value) => {
        if (!value) return '名字不能为空'
      },
    })

    if (p.isCancel(name)) {
      p.cancel('已取消')
      process.exit(0)
    }

    // 选择
    const color = await p.select({
      message: '选择你喜欢的颜色',
      options: [
        { value: 'red', label: '红色' },
        { value: 'green', label: '绿色' },
        { value: 'blue', label: '蓝色' },
      ],
    })

    if (p.isCancel(color)) {
      p.cancel('已取消')
      process.exit(0)
    }

    // 多选
    const features = await p.multiselect({
      message: '选择要启用的功能',
      options: [
        { value: 'logging', label: '日志记录' },
        { value: 'metrics', label: '指标收集' },
        { value: 'tracing', label: '链路追踪' },
      ],
    })

    if (p.isCancel(features)) {
      p.cancel('已取消')
      process.exit(0)
    }

    // 确认
    const confirmed = await p.confirm({
      message: '确认提交?',
    })

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('已取消')
      process.exit(0)
    }

    // 带 spinner 的操作
    const s = p.spinner()
    s.start('处理中...')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    s.stop('处理完成')

    // 结果输出
    logger.info(`你好, ${name}!`)
    logger.info(`你选择了: ${color}`)
    logger.info(`启用的功能: ${(features as string[]).join(', ')}`)

    if (args.env) {
      logger.info(`当前使用环境: ${args.env}`)
    }

    p.outro('示例命令执行完成')
  },
})
