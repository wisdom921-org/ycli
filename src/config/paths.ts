import { homedir } from 'node:os'
import { join } from 'node:path'

export const CONFIG_DIR = join(homedir(), '.ycli')
export const CURRENT_ENV_FILE = join(CONFIG_DIR, '.current')

export const getConfigPath = (env: string) => join(CONFIG_DIR, `config.${env}.json`)
