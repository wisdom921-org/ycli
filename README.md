# ycli

个人 CLI 工具集。

## 安装

```bash
brew tap wisdom921/tap
brew install ycli
```

## 快速开始

### 初始化配置

```bash
ycli env init
```

按提示输入 MySQL 和 MongoDB 连接信息。

### 环境管理

```bash
# 列出所有环境
ycli env list

# 切换环境
ycli env use prd

# 查看当前配置
ycli env show
```

### 临时使用其他环境

所有命令支持 `--env` 参数：

```bash
ycli example --env prd
```

## 开发

### 环境要求

- Bun >= 1.0

### 本地运行

```bash
bun run src/index.ts --help
```

### 代码检查

```bash
bun run lint
bun run format
```

### 本地构建

```bash
bun run build
```

## License

MIT
