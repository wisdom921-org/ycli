# 测试方案

## 运行命令

```bash
bun run test          # 运行全部测试（bun --bun vitest run）
bun run test:watch    # 开发时 watch 模式
bun run typecheck     # TypeScript 类型检查
bun run lint          # Biome 代码检查
```

## 测试分层

### L0：单元测试（mock 隔离）

测试各模块内部逻辑，外部依赖全部 mock。

| 测试文件 | 覆盖范围 | mock 策略 |
|----------|---------|-----------|
| `config/__tests__/env.test.ts` | ConfigSchema Zod 校验 | 无 mock，纯 schema 测试 |
| `config/__tests__/index.test.ts` | 配置 CRUD（save/load/list/exists） | mock `@/config/paths.ts` 到临时目录，真实文件系统操作 |
| `agent/__tests__/provider.test.ts` | 多 provider 注册 + getModel | 无 mock，直接调用 SDK API |
| `agent/__tests__/tools.test.ts` | 10 个 Agent 工具逻辑 | `vi.hoisted()` + `vi.mock()` mock DB/HTTP |
| `agent/__tests__/repl.test.ts` | system prompt 构建 + AI SDK API 行为验证 | mock `node:fs`、`@/config/paths.ts`；用 `MockLanguageModelV3` 验证 generateText 行为 |

### L1：CLI 子进程冒烟测试

直接用 `child_process.spawn` 运行真实 CLI 进程，检查 stdout/stderr/exit code。零 mock，测的是真实二进制路径。

| 测试文件 | 覆盖范围 |
|----------|---------|
| `src/__tests__/cli.test.ts` | 未配置时友好报错（Bug #2 回归）、env list 不触发 Agent 启动（Bug #1 回归）、env show 错误处理、--help、--version、env --help |

### L2：Agent 循环集成测试

测试 `runAgentLoop` 的循环逻辑，使用 `MockLanguageModelV3`（AI SDK 官方 mock provider），不 mock `generateText`，让 SDK 走真实路径。

| 测试文件 | 覆盖范围 |
|----------|---------|
| `agent/__tests__/agent-loop.test.ts` | 纯文本对话、读工具调用（SDK 多步自动执行）、连续多步工具调用、写工具 approval 通过/拒绝、messages 历史累积 |

mock 策略：
- `@clack/prompts` — mock `confirm`（模拟 approval 交互）
- `@/utils/logger.ts` — mock 避免输出干扰
- `console.log` — spyOn 验证输出内容
- AI SDK **不 mock** — `generateText` 走真实路径

## 已知坑点

### 1. Bun + Vitest + Zod 模块解析

Bun 的 SSR 模块求值器对命名空间重导出模式求值失败，Zod 4 受影响。

**Workaround**：`vitest.config.ts` 添加 `resolve.alias` 指向源文件：
```typescript
resolve: { alias: { zod: resolve(__dirname, 'node_modules/zod/src/index.ts') } }
```
test 脚本需使用 `bun --bun vitest run`。详见 [oven-sh/bun#21614](https://github.com/oven-sh/bun/issues/21614)。

### 2. consola 在测试环境静默

consola 检测到 `TEST=true` 环境变量会抑制所有输出。vitest 自动注入此变量并被子进程继承。

**坑点**：Bun 的 `process.env` 是 Proxy 对象，`{...process.env}` spread 后再 `delete` 无法可靠清除变量。

**解决方案**：CLI 子进程测试中用白名单方式构建环境，只传递必要的系统变量：
```typescript
const INHERITED_ENV_KEYS = ['PATH', 'HOME', 'SHELL', 'USER', 'LANG', 'TERM', 'TMPDIR']
```

### 3. vi.mock 工厂函数提升

Vitest 的 `vi.mock` 工厂函数会被提升到文件顶部，引用的 mock 变量必须通过 `vi.hoisted()` 声明，否则会遇到 TDZ（Temporal Dead Zone）错误。

```typescript
const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }))
vi.mock('@/some/module', () => ({ fn: mockFn }))
```

### 4. citty 父命令 run 行为

citty 匹配子命令后仍会调用父命令的 `run` 回调。`src/index.ts` 中通过检查 `rawArgs` 是否包含已知子命令名来跳过 Agent 启动。新增子命令时需要同步更新 `subCommands` 对象。

## 自动化覆盖不了的场景

| 场景 | 原因 | 建议验证方式 |
|------|------|-------------|
| 真实 LLM 对话质量 | Mock 模型只返回预设响应 | 手动冒烟测试 |
| REPL 内置命令（/quit, /clear, /model） | 依赖 readline TTY 输入循环 | 手动验证 |
| `ycli env init` 交互流程 | @clack/prompts 依赖 TTY | 手动验证 |
| `bun build` 编译产物行为 | 编译后二进制可能有模块解析差异 | `./dist/ycli --help` 手动冒烟 |
| 真实数据库连接 | 需要 MySQL/MongoDB 实例 | 配合真实环境手动测试 |

## 新增测试检查清单

新增功能或修改代码时：

1. 涉及配置 schema → 更新 `env.test.ts`
2. 涉及 Agent 工具 → 更新 `tools.test.ts`
3. 涉及 CLI 命令路由 → 更新 `cli.test.ts`
4. 涉及 Agent 循环逻辑 → 更新 `agent-loop.test.ts`
5. 新增子命令 → 确认 `src/index.ts` 的 `subCommands` 对象已更新
6. 新增依赖 → 检查是否需要 vitest alias（参考坑点 #1）
