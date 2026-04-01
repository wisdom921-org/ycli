import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      zod: resolve(__dirname, 'node_modules/zod/src/index.ts'),
    },
  },
})
