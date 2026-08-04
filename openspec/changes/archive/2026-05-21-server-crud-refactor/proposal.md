## Why

当前 CRUD API 使用 `/api/{userId}/{pageId}/{resource}` 路径格式，要求前端页面感知 userId 和 pageId 才能调用接口。但前端页面在 iframe 中运行，其 URL 已包含这些信息。通过将 CRUD 路由挂载到 serve 路径下，前端可以使用相对路径 `./api/{resource}` 调用接口，无需硬编码任何上下文信息。

## What Changes

- **BREAKING** 移除 `/api/{userId}/{pageId}/{resource}` CRUD 路由
- 新增 `/serve/{userId}/{pageId}/api/{resource}` 相对路径 CRUD 路由
- 前端页面可直接使用 `fetch('./api/todos')` 调用 CRUD 接口
- 更新 schema-management 响应中的 endpoints 信息（create_schema 返回相对路径端点）
- 更新现有 e2e 测试以适配新路由

## Capabilities

### New Capabilities

（无新增 capability）

### Modified Capabilities

- `crud-api`: CRUD 路由路径从 `/api/{userId}/{pageId}/{resource}` 变更为 `/serve/{userId}/{pageId}/api/{resource}`，前端无需感知 userId/pageId
- `schema-management`: create_schema 响应中需返回基于 serve 路径的 endpoints URL

## Impact

- `packages/server/src/routes/crud.ts` 路由路径变更
- `packages/server/src/routes/serve.ts` 需集成 CRUD 路由处理
- `packages/server/src/index.ts` 路由注册方式调整
- `packages/server/tests/e2e/` 测试更新
- `openspec/specs/crud-api/spec.md` 规格更新
- `openspec/specs/schema-management/spec.md` 规格更新
