## 1. 路由重构

- [x] 1.1 将 CRUD 路由逻辑从 `crud.ts` 合并到 `serve.ts`，路径改为 `/serve/{userId}/{pageId}/api/{resource}`
- [x] 1.2 更新 SPA fallback 逻辑，排除 `api/` 子路径
- [x] 1.3 移除 `crud.ts` 路由文件和 `index.ts` 中的注册
- [x] 1.4 更新 `schemas.ts` 中 create_schema 响应，增加 `endpoints` 字段

## 2. 规格更新

- [x] 2.1 更新主规格 `openspec/specs/crud-api/spec.md`，将路径格式改为 `/serve/{userId}/{pageId}/api/{resource}`
- [x] 2.2 更新主规格 `openspec/specs/schema-management/spec.md`，增加 endpoints 响应字段

## 3. 测试更新

| Spec | Scenario | Status |
|------|----------|--------|
| crud-api | 基本列表 | ✓ |
| crud-api | 分页查询 | ✓ |
| crud-api | 排序查询 | ✓ |
| crud-api | 过滤查询 | ✓ |
| crud-api | 资源不存在 | ✓ |
| crud-api | 成功新增 | ✓ |
| crud-api | timestamp 自动填充 | ✓ |
| crud-api | 超出单表行数限制 | ✓ |
| crud-api | 必填字段缺失 | ✓ |
| crud-api | 记录存在（单条） | ✓ |
| crud-api | 记录不存在（单条） | ✓ |
| crud-api | 成功更新 | ✓ |
| crud-api | 记录不存在（更新） | ✓ |
| crud-api | 成功删除 | ✓ |
| crud-api | 总数 | ✓ |
| crud-api | 带过滤的计数 | ✓ |
| crud-api | 无 API Key 访问 CRUD | ✓ |
| schema-management | 成功创建 Schema（含 endpoints） | ✓ |

- [x] 3.1 更新 `tests/e2e/helpers.ts` 中的测试 URL 生成逻辑
- [x] 3.2 更新 `tests/e2e/crud.test.ts` 中所有 CRUD 请求路径
- [x] 3.3 更新 `tests/e2e/schemas.test.ts` 验证 create_schema 响应包含 endpoints
- [x] 3.4 运行全部 e2e 测试，确认通过

## 4. 清理

- [x] 4.1 删除 `packages/server/src/routes/crud.ts`
- [x] 4.2 更新 `index.ts` 移除 crudRoutes 注册
- [x] 4.3 编译验证，确认无引用残留
