## 1. 系统提示词重构

- [x] 1.1 重构 `context.ts` 的 `buildSystemPrompt` 签名为 `(systemContext: string, schemaContext: string, hint?: string) => string`，按系统层 → 数据层 → 应用层顺序拼接
- [x] 1.2 新增 `buildSystemContext` 函数，接收用户信息 `{ name: string } | null` 和应用名称 `string | null`，生成系统层提示词（包含当前用户、当前应用、工具使用规则）
- [x] 1.3 编写 `context.ts` 的单元测试：验证两层拼接顺序、空 schema/hint 时的行为、系统层内容格式

## 2. useAgent 初始化增强

- [x] 2.1 在 `use-agent.ts` 的 `init()` 中并行获取用户信息（`/api/me`）和 schema context（`fetchSchemaContext`），从 pathname 解析应用名称
- [x] 2.2 将获取的用户信息和应用名称传给 `buildSystemContext` 生成系统层，再调用 `buildSystemPrompt(systemContext, schemaCtx, systemHint)` 组合完整提示词
- [x] 2.3 编写 `use-agent.ts` 的单元测试：验证用户信息获取失败时降级为"未知"、应用名称解析逻辑

## 3. 集成验证

- [x] 3.1 运行 init-repo 的 `npm run build`，确认 TypeScript 编译通过
- [x] 3.2 部署到服务器，用浏览器测试 Agent 聊天：已登录用户发送操作请求时 LLM 应主动调用工具而非仅给建议
