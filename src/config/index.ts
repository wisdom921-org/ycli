import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { type Config, ConfigSchema } from './env.ts'
import { CONFIG_DIR, CURRENT_ENV_FILE, getConfigPath } from './paths.ts'

let cachedConfig: Config | null = null
let cachedEnv: string | null = null

// 获取当前环境
export const getCurrentEnv = (): string | null => {
  if (!existsSync(CURRENT_ENV_FILE)) return null
  return readFileSync(CURRENT_ENV_FILE, 'utf-8').trim()
}

// 设置当前环境
export const setCurrentEnv = (env: string) => {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CURRENT_ENV_FILE, env)
}

// 加载配置（支持 --env 覆盖）
export const loadConfig = (envOverride?: string): Config => {
  const env = envOverride || getCurrentEnv()
  if (!env) throw new Error('未设置环境，请先运行 ycli env init')

  if (cachedConfig && cachedEnv === env) return cachedConfig

  const configPath = getConfigPath(env)
  if (!existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}`)
  }

  const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
  cachedConfig = ConfigSchema.parse(raw)
  cachedEnv = env
  return cachedConfig
}

// 保存配置
export const saveConfig = (env: string, config: Config) => {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(getConfigPath(env), JSON.stringify(config, null, 2))
}

// 列出所有环境
export const listEnvs = (): string[] => {
  if (!existsSync(CONFIG_DIR)) return []
  return readdirSync(CONFIG_DIR)
    .filter((f) => f.startsWith('config.') && f.endsWith('.json'))
    .map((f) => f.replace('config.', '').replace('.json', ''))
}

// 检查环境是否存在
export const envExists = (env: string): boolean => {
  return existsSync(getConfigPath(env))
}

export type { Config } from './env.ts'
export { CONFIG_DIR, getConfigPath } from './paths.ts'
