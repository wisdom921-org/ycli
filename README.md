# ycli

个人 AI Agent，运行在终端中。通过自然语言操作 MySQL/MongoDB 数据库、发起 HTTP 请求。

## 安装

```bash
brew tap wisdom921/tap
brew install ycli
```

## 快速开始

### 1. 初始化配置

```bash
ycli env init
```

按提示配置：
- MySQL / MongoDB 连接信息
- HTTP baseUrl（可选）
- AI 助手（provider + API Key + 模型）

支持 Anthropic、OpenAI、Ollama（本地）、OpenRouter 四个 provider。

### 2. 启动 Agent

```bash
ycli
```

直接输入自然语言即可。Agent 会自动查询数据库 schema、规划查询、执行操作。写操作（INSERT/UPDATE/DELETE 等）执行前会弹出确认提示。

### 3. 内置命令

| 命令 | 说明 |
|------|------|
| `/quit` `/exit` | 退出 |
| `/clear` | 清空对话历史 |
| `/model provider:model-id` | 临时切换模型 |

## 环境管理

```bash
ycli env list              # 列出所有环境
ycli env use prd           # 切换环境
ycli env show              # 查看当前配置
ycli env set ai.model xxx  # 修改单个配置字段
```

所有命令支持 `--env` 参数临时指定环境：

```bash
ycli --env prd
```

## 开发

### 环境要求

- Bun >= 1.3

### 常用命令

```bash
bun run dev        # 本地运行
bun run test       # 运行测试
bun run typecheck  # 类型检查
bun run lint       # 代码检查
bun run build      # 构建可执行文件
```

## License

MIT
