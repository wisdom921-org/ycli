import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { $ } from 'bun'

// 仅 macOS 平台
const targets = [
  { name: 'darwin-arm64', target: 'bun-darwin-arm64' },
  { name: 'darwin-x64', target: 'bun-darwin-x64' },
]

const distDir = 'dist'

// 清理并创建 dist 目录
if (existsSync(distDir)) {
  await rm(distDir, { recursive: true })
}
await mkdir(distDir)

for (const { name, target } of targets) {
  console.log(`Building for ${name}...`)
  await $`bun build src/index.ts --compile --target=${target} --outfile=${distDir}/ycli-${name}`
  console.log(`✓ Built ${distDir}/ycli-${name}`)
}

console.log('\nBuild completed!')
