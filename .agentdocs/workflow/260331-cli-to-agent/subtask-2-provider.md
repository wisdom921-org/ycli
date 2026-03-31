# 子任务 2：Provider 层

## 交付物

- `src/agent/provider.ts`：基于 `createProviderRegistry` 的多 provider 管理
- 可根据配置创建 LLM model 实例，支持运行时切换模型
- 单元测试通过

## TODO

- [ ] 新建 `src/agent/provider.ts`（createProviderRegistry + getModel）
- [ ] 新建测试
- [ ] lint + typecheck + test 验证

## 实施规格

> 详细规格在实施前编写。概要见主文档方案设计。

**核心要点**：
- 使用 `createProviderRegistry` 注册已配置 API Key 的 providers
- 有 `anthropicApiKey` → 注册 Anthropic；有 `openaiApiKey` → 注册 OpenAI；Ollama 始终注册
- 导出 `getModel(providerId?, modelId?)` 解析为 LanguageModel 实例
- 通过 `registry.languageModel('anthropic:claude-sonnet-4-20250514')` 格式访问模型
- 测试：mock 配置，验证 registry 注册了正确的 providers

## 错误追踪

| 错误描述 | 尝试次数 | 解决方案 |
|----------|----------|----------|
| （暂无） | | |
