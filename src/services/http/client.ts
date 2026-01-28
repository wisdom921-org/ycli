import { type FetchOptions, ofetch } from 'ofetch'
import { loadConfig } from '@/config/index.ts'

export const createApiClient = (envOverride?: string) => {
  const config = loadConfig(envOverride)

  if (!config.http?.baseUrl) {
    throw new Error('未配置 HTTP baseUrl')
  }

  return ofetch.create({
    baseURL: config.http.baseUrl,
    retry: 1,
    timeout: 10000,
    // 预留拦截器扩展点，按需启用：
    // onRequest({ options }) { /* 鉴权逻辑 */ },
    // onResponseError({ response }) { /* 错误处理 */ },
  } as FetchOptions)
}
