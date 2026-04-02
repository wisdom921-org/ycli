import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI_ENTRY = resolve(__dirname, '..', 'index.ts')
const PROJECT_ROOT = resolve(__dirname, '../..')

/**
 * 构建干净的子进程环境。
 * vitest 注入 TEST=true 让 consola 静默输出，必须排除测试相关变量。
 * Bun 的 process.env 是 Proxy，常规的 spread/entries 无法可靠清除，
 * 因此采用白名单方式只传递必要的系统变量。
 */
const INHERITED_ENV_KEYS = ['PATH', 'HOME', 'SHELL', 'USER', 'LANG', 'TERM', 'TMPDIR']

function buildCleanEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of INHERITED_ENV_KEYS) {
    const val = process.env[key]
    if (val) env[key] = val
  }
  return { ...env, ...overrides }
}

/** 运行 CLI 子进程，捕获 stdout/stderr/exitCode */
function runCli(
  args: string[],
  options: { home?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((done) => {
    const proc: ChildProcess = spawn('bun', [CLI_ENTRY, ...args], {
      cwd: PROJECT_ROOT,
      env: buildCleanEnv(options.home ? { HOME: options.home } : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    const timer = setTimeout(() => {
      proc.kill()
      done({ stdout, stderr, exitCode: 1 })
    }, options.timeout ?? 5000)

    proc.on('close', (code: number | null) => {
      clearTimeout(timer)
      done({ stdout, stderr, exitCode: code ?? 1 })
    })

    // 关闭 stdin 防止 REPL 阻塞
    proc.stdin?.end()
  })
}

/** 去除 ANSI 转义序列 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列清理必须匹配控制字符
  return str.replace(/\u001b\[[0-9;]*m/g, '')
}

describe('CLI 子进程冒烟测试', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ycli-cli-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('未配置时友好报错（非 stack trace）', async () => {
    const { stdout, stderr, exitCode } = await runCli([], { home: tmpDir })
    expect(exitCode).toBe(1)
    const output = stripAnsi(stdout + stderr)
    expect(output).toContain('未设置环境')
    // 确认是友好消息而非 stack trace
    expect(output).not.toContain('at loadConfig')
  })

  it('env list 正常退出，不触发 Agent 启动', async () => {
    const { stdout, stderr, exitCode } = await runCli(['env', 'list'], { home: tmpDir })
    expect(exitCode).toBe(0)
    const output = stripAnsi(stdout + stderr)
    expect(output).toContain('暂无已配置的环境')
    // 不应触发 Agent 启动错误
    expect(output).not.toContain('未设置环境')
  })

  it('env show 无配置时报错退出', async () => {
    const { stdout, stderr, exitCode } = await runCli(['env', 'show'], { home: tmpDir })
    expect(exitCode).toBe(1)
    expect(stripAnsi(stdout + stderr)).toContain('未设置环境')
  })

  it('--help 显示帮助信息', async () => {
    const { stdout, exitCode } = await runCli(['--help'])
    expect(exitCode).toBe(0)
    expect(stripAnsi(stdout)).toContain('ycli')
    expect(stripAnsi(stdout)).toContain('env')
  })

  it('--version 显示版本号', async () => {
    const { stdout, exitCode } = await runCli(['--version'])
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe('0.1.0')
  })

  it('env --help 显示子命令列表', async () => {
    const { stdout, exitCode } = await runCli(['env', '--help'])
    expect(exitCode).toBe(0)
    const clean = stripAnsi(stdout)
    expect(clean).toContain('init')
    expect(clean).toContain('list')
    expect(clean).toContain('show')
    expect(clean).toContain('set')
  })
})
