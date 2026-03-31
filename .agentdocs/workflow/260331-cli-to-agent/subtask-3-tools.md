# 子任务 3：工具层

## 交付物

- MySQL 工具：`mysqlQuery`（读，直接执行）+ `mysqlExecute`（写，needsApproval）
- MongoDB 工具：`mongoQuery`（读）+ `mongoExecute`（写，needsApproval）
- HTTP 工具：`httpRequest`（GET 免确认，其余 needsApproval）
- 聚合导出 `agentTools`
- 单元测试通过

## TODO

- [ ] 新建 `src/agent/tools/mysql.ts`
- [ ] 新建 `src/agent/tools/mongo.ts`
- [ ] 新建 `src/agent/tools/http.ts`
- [ ] 新建 `src/agent/tools/index.ts`
- [ ] 新建测试
- [ ] lint + typecheck + test 验证

## 实施规格

> 详细规格在实施前编写。概要见主文档方案设计。

**核心要点**：
- 使用 AI SDK 的 `tool()` 函数定义，`inputSchema` 用 zod
- 读工具：无 needsApproval，直接执行并返回结果
- 写工具：`needsApproval: true`，SDK 自动暂停等待确认
- HTTP 工具：`needsApproval` 使用函数形式 `({ input }) => input.method !== 'GET'`
- MySQL：复用 `src/services/db/drizzle.ts` 的 `getDb()`，需暴露底层 mysql2 connection 执行 raw SQL
- MongoDB：复用 `src/services/db/mongoose.ts` 的 `connectMongo()`，通过 `mongoose.connection.db` 访问原生 API
- HTTP：使用 ofetch 直接发请求
- 测试：mock DB 连接，验证工具 schema、读写分类、needsApproval 标记

## 错误追踪

| 错误描述 | 尝试次数 | 解决方案 |
|----------|----------|----------|
| （暂无） | | |
