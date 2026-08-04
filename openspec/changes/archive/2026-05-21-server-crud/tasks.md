## 1. 基础设施

- [x] 1.1 扩展 PageMeta 接口，新增 `schemas` 字段（DataSchema 数组）
- [x] 1.2 创建 `packages/server/src/lib/crud-db.ts`：封装页面级 SQLite 的初始化、加载、保存、建表操作
- [x] 1.3 实现字段类型到 SQL 类型的映射函数和 schema 名称校验函数

## 2. Schema 管理接口

- [x] 2.1 创建 `packages/server/src/routes/schemas.ts`：POST /api/schemas（创建）
- [x] 2.2 实现 PUT /api/schemas/:name（增量更新，ADD COLUMN）
- [x] 2.3 实现 DELETE /api/schemas/:name（DROP TABLE + 清理 meta.json）
- [x] 2.4 实现 GET /api/schemas（列出 pageId 下所有 schema）
- [x] 2.5 在 index.ts 中注册 schemas 路由（需鉴权的作用域内）
- [x] 2.6 手动测试：创建 schema → 列出 → 更新（加字段）→ 删除

## 3. CRUD 数据接口

- [x] 3.1 实现 `crud-db.ts` 中的 CRUD 操作函数：insert、selectAll（分页+过滤+排序）、selectById、update、delete、count
- [x] 3.2 创建 `packages/server/src/routes/crud.ts`：GET /api/{userId}/{pageId}/{resource}（列表查询）
- [x] 3.3 实现 GET /api/{userId}/{pageId}/{resource}/count（计数）
- [x] 3.4 实现 POST /api/{userId}/{pageId}/{resource}（新增记录）
- [x] 3.5 实现 GET /api/{userId}/{pageId}/{resource}/:id（单条查询）
- [x] 3.6 实现 PUT /api/{userId}/{pageId}/{resource}/:id（更新记录）
- [x] 3.7 实现 DELETE /api/{userId}/{pageId}/{resource}/:id（删除记录）
- [x] 3.8 在 index.ts 中注册 crud 路由（公开作用域，不需要鉴权）
- [x] 3.9 手动测试：通过 curl 调用各 CRUD 端点

## 4. E2E 测试

| Spec | Scenario | Status |
|------|----------|--------|
| schema-management | 成功创建 Schema | ✓ |
| schema-management | Schema 名称重复 | ✓ |
| schema-management | Schema 名称不合法 | ✓ |
| schema-management | 页面不存在 | ✓ |
| schema-management | 添加新字段 | ✓ |
| schema-management | 尝试删除字段（无操作） | ✓ |
| schema-management | 成功删除 | ✓ |
| schema-management | Schema 不存在 | ✓ |
| schema-management | 列出已有 Schemas | ✓ |
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

- [x] 4.1 配置 vitest 测试框架（`packages/server/`）
- [x] 4.2 编写测试辅助函数：启动/关闭测试服务器、创建测试页面和 schema
- [x] 4.3 为 schema-management > Scenario: 成功创建 Schema 编写 e2e 测试
- [x] 4.4 为 schema-management > Scenario: Schema 名称重复 编写 e2e 测试
- [x] 4.5 为 schema-management > Scenario: Schema 名称不合法 编写 e2e 测试
- [x] 4.6 为 schema-management > Scenario: 页面不存在 编写 e2e 测试
- [x] 4.7 为 schema-management > Scenario: 添加新字段 编写 e2e 测试
- [x] 4.8 为 schema-management > Scenario: 尝试删除字段（无操作） 编写 e2e 测试
- [x] 4.9 为 schema-management > Scenario: 成功删除 编写 e2e 测试
- [x] 4.10 为 schema-management > Scenario: Schema 不存在 编写 e2e 测试
- [x] 4.11 为 schema-management > Scenario: 列出已有 Schemas 编写 e2e 测试
- [x] 4.12 为 crud-api > Scenario: 基本列表 编写 e2e 测试
- [x] 4.13 为 crud-api > Scenario: 分页查询 编写 e2e 测试
- [x] 4.14 为 crud-api > Scenario: 排序查询 编写 e2e 测试
- [x] 4.15 为 crud-api > Scenario: 过滤查询 编写 e2e 测试
- [x] 4.16 为 crud-api > Scenario: 资源不存在 编写 e2e 测试
- [x] 4.17 为 crud-api > Scenario: 成功新增 编写 e2e 测试
- [x] 4.18 为 crud-api > Scenario: timestamp 自动填充 编写 e2e 测试
- [x] 4.19 为 crud-api > Scenario: 超出单表行数限制 编写 e2e 测试
- [x] 4.20 为 crud-api > Scenario: 必填字段缺失 编写 e2e 测试
- [x] 4.21 为 crud-api > Scenario: 记录存在（单条） 编写 e2e 测试
- [x] 4.22 为 crud-api > Scenario: 记录不存在（单条） 编写 e2e 测试
- [x] 4.23 为 crud-api > Scenario: 成功更新 编写 e2e 测试
- [x] 4.24 为 crud-api > Scenario: 记录不存在（更新） 编写 e2e 测试
- [x] 4.25 为 crud-api > Scenario: 成功删除 编写 e2e 测试
- [x] 4.26 为 crud-api > Scenario: 总数 编写 e2e 测试
- [x] 4.27 为 crud-api > Scenario: 带过滤的计数 编写 e2e 测试
- [x] 4.28 为 crud-api > Scenario: 无 API Key 访问 CRUD 编写 e2e 测试
- [x] 4.29 运行全部 e2e 测试，确认通过
