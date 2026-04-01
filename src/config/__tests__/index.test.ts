import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testDir = `/tmp/ycli-test-${Math.random().toString(36).slice(2)}`
const testCurrentEnvFile = join(testDir, '.current')

vi.mock('@/config/paths.ts', () => ({
  CONFIG_DIR: testDir,
  CURRENT_ENV_FILE: testCurrentEnvFile,
  getConfigPath: (env: string) => join(testDir, `config.${env}.json`),
}))

// Import after mocking
const { saveConfig, loadConfig, listEnvs, envExists, getCurrentEnv, setCurrentEnv } = await import(
  '@/config/index.ts'
)

const baseConfig = {
  mysql: { host: 'localhost', port: 3306, user: 'root', password: 'pass', database: 'test' },
  mongo: { uri: 'mongodb://localhost:27017/test' },
}

const configWithAi = {
  ...baseConfig,
  ai: {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-20250514',
    anthropicApiKey: 'sk-test',
    ollamaBaseUrl: 'http://localhost:11434',
  },
}

describe('config/index', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('saveConfig + loadConfig 往返一致（不含 ai 段）', () => {
    saveConfig('env-no-ai', baseConfig)
    const loaded = loadConfig('env-no-ai')
    expect(loaded.mysql.host).toBe('localhost')
    expect(loaded.ai).toBeUndefined()
  })

  it('saveConfig + loadConfig 往返一致（含 ai 段）', () => {
    saveConfig('env-with-ai', configWithAi)
    const loaded = loadConfig('env-with-ai')
    expect(loaded.ai?.provider).toBe('anthropic')
    expect(loaded.ai?.anthropicApiKey).toBe('sk-test')
  })

  it('loadConfig 无 ai 段时返回 undefined（向后兼容）', () => {
    saveConfig('env-compat', baseConfig)
    const loaded = loadConfig('env-compat')
    expect(loaded.ai).toBeUndefined()
  })

  it('listEnvs 正确列出已保存环境', () => {
    saveConfig('dev', baseConfig)
    saveConfig('prd', baseConfig)
    const envs = listEnvs()
    expect(envs).toContain('dev')
    expect(envs).toContain('prd')
    expect(envs).toHaveLength(2)
  })

  it('envExists 对存在的环境返回 true', () => {
    saveConfig('existing', baseConfig)
    expect(envExists('existing')).toBe(true)
  })

  it('envExists 对不存在的环境返回 false', () => {
    expect(envExists('nonexistent')).toBe(false)
  })

  it('loadConfig 缺失环境时抛出明确错误', () => {
    expect(() => loadConfig('missing')).toThrow()
  })

  it('getCurrentEnv 无配置文件时返回 null', () => {
    expect(getCurrentEnv()).toBeNull()
  })

  it('setCurrentEnv + getCurrentEnv 往返一致', () => {
    setCurrentEnv('dev')
    expect(getCurrentEnv()).toBe('dev')
  })
})
