# ycli 技术架构

## 技术栈

| 模块 | 选型 | 说明 |
|------|------|------|
| 运行时 | Bun | 高性能 JavaScript 运行时 |
| CLI 框架 | citty | 轻量级命令行框架 |
| 交互 UI | @clack/prompts | 美观的交互式提示 |
| 日志输出 | consola | 统一日志管理 |
| HTTP 请求 | ofetch | 现代 HTTP 客户端 |
| MySQL ORM | drizzle-orm | 类型安全的 ORM |
| MongoDB ODM | mongoose | MongoDB 对象建模 |
| 配置校验 | zod | 运行时类型校验 |
| 代码工具 | biome | 代码格式化与检查 |
| LLM 框架 | ai (Vercel AI SDK v6) | 统一多 provider 接口，内置 tool calling + approval |
| LLM Provider | @ai-sdk/anthropic, @ai-sdk/openai, ollama-ai-provider-v2 | Claude / OpenAI / 本地 Ollama 模型 |
| 测试 | vitest | 单元测试，支持 AI SDK mock provider |

## 目录结构

```
ycli/
├── src/
│   ├── index.ts              # CLI 入口，命令注册
│   ├── commands/             # 命令实现
│   ├── services/             # 业务逻辑层
│   │   ├── db/               # 数据库服务
│   │   └── http/             # HTTP 服务
│   ├── config/               # 配置管理
│   │   └── __tests__/        # 配置单元测试
│   └── utils/                # 工具函数
├── scripts/                  # 构建脚本
├── homebrew/                 # Homebrew Formula 模板
├── drizzle/                  # MySQL Schema
└── models/                   # MongoDB Models
```

## 配置管理

### 配置文件位置

- 配置目录：`~/.ycli/`
- 环境配置：`~/.ycli/config.{env}.json`
- 当前环境：`~/.ycli/.current`

### 环境切换

- `ycli env init` - 交互式初始化配置
- `ycli env use <env>` - 切换环境
- `ycli env list` - 列出所有环境
- `ycli env show` - 显示当前配置

### 临时覆盖

所有命令支持 `--env` 参数临时使用指定环境，不影响 `.current` 文件。

### AI 配置（可选）

`ycli env init` 可选配置 AI 助手，存储在 config 文件的 `ai` 段中：

- `provider`：LLM 提供商（`anthropic` / `openai` / `ollama`，默认 `anthropic`）
- `model`：模型 ID（默认 `claude-sonnet-4-20250514`）
- `anthropicApiKey` / `openaiApiKey`：对应 provider 的 API Key
- `ollamaBaseUrl`：Ollama 服务地址（默认 `http://localhost:11434`）

## 数据库连接

### MySQL (Drizzle)

- 懒加载连接，首次调用 `getDb()` 时建立
- 单例模式，复用连接
- Schema 定义在 `drizzle/schema.ts`

### MongoDB (Mongoose)

- 懒加载连接，首次调用 `connectMongo()` 时建立
- Model 定义在 `models/` 目录
- 使用完毕可调用 `disconnectMongo()` 断开

## HTTP 客户端

- 基于 ofetch 封装
- 从配置读取 baseUrl
- 预留拦截器扩展点（如鉴权）

## 构建与发布

### 构建目标

- darwin-arm64 (Apple Silicon)
- darwin-x64 (Intel Mac)

### 发布流程

1. 更新 package.json 版本号
2. 创建 Git Tag
3. GitHub Actions 自动构建并发布到 Release
4. 自动更新 Homebrew Tap

### 安装方式

```bash
brew tap wisdom921/tap
brew install ycli
```
