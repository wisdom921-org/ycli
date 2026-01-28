import { z } from 'zod'

// 配置文件 Schema
export const ConfigSchema = z.object({
  // MySQL
  mysql: z.object({
    host: z.string(),
    port: z.number().default(3306),
    user: z.string(),
    password: z.string(),
    database: z.string(),
  }),

  // MongoDB
  mongo: z.object({
    uri: z.string(),
  }),

  // HTTP（可选）
  http: z
    .object({
      baseUrl: z.string().url(),
    })
    .optional(),
})

export type Config = z.infer<typeof ConfigSchema>
