## 1. 共享类型定义

- [x] 1.1 [GREEN] 在 shared/src/models.ts 新增 `DbMode`、`ManifestDb`、`ManifestDbAccess` 类型
- [x] 1.2 [GREEN] 在 shared/src/index.ts 导出新类型
- [x] 1.3 构建 shared 包验证类型编译通过

## 2. meta.json 扩展 — db 配置存储

- [x] 2.1 [RED] 编写 storage 测试：验证 PageMeta 写入/读取 `db` 字段、无 `db` 字段时的默认值
- [x] 2.2 [GREEN] 在 storage.ts 的 PageMeta 接口新增 `db` 字段（类型为 ManifestDb | undefined）
- [x] 2.3 [GREEN] 新增 `readDbConfig(dataDir, userId, name)` 辅助函数，返回带默认值的 db 配置

## 3. CLI manifest.json 扩展

- [x] 3.1 [GREEN] 在 `packages/cli/src/project.rs` 的 Manifest struct 新增 `db` 字段（Option<ManifestDb>）
- [x] 3.2 [GREEN] 在 `packages/cli/src/commands/upload.rs` 的上传逻辑中发送 `dbConfig` form field
- [x] 3.3 [GREEN] 在 `packages/cli/src/commands/init.rs` 的 init 命令中生成默认 db 配置（mode: "crud"）

## 4. 服务端 upload 处理 dbConfig

- [x] 4.1 [RED] 编写 upload 测试：验证 upload 请求携带 dbConfig 时 meta.json 写入 db 字段
- [x] 4.2 [GREEN] 在 upload.ts 中解析 `dbConfig` form field 并存入 meta.json 的 `db` 字段

## 5. crud-db 连接池改造

- [x] 5.1 [RED] 编写 crud-db 测试：测试长连接复用（同一 dbPath 返回同一实例）、写操作后持久化、空闲连接自动关闭、嵌套调用（insertRow 内部调 countRows）使用同一实例
- [x] 5.2 [GREEN] 实现 `crud-db.ts` 连接池：`getConnection()`、`markDirty()`、`saveConnection()`、`closeIdleConnections()`、`closeAllConnections()`
- [x] 5.3 [GREEN] 改造现有 CRUD 函数（selectAll、insertRow、updateRow、deleteRow、countRows、selectById 等）使用 `getConnection()`，移除 loadDb/saveDb/close 调用
- [x] 5.4 [REFACTOR] 清理旧的 loadDb/saveDb 独立函数，统一连接管理接口

## 6. 访问控制 meta.db fallback

- [x] 6.1 [RED] 编写 access-control 测试：测试 RouteAccess fallback 到 meta.db.defaultAccess、Schema 配置优先于 meta.db、sqlAccess 检查逻辑
- [x] 6.2 [GREEN] 实现 `checkRouteAccessWithManifest()` 函数，整合 meta.db.defaultAccess fallback
- [x] 6.3 [GREEN] 在 serve.ts 的 handleCrudRequest 中集成 fallback 逻辑（替换所有 checkRouteAccess 调用点）
- [x] 6.4 [REFACTOR] 统一访问控制函数签名，减少重复代码

## 7. Raw SQL 端点

- [x] 7.1 [RED] 编写 serve 测试：测试 raw SQL 端点路由解析（`api/db/exec` 不返回 400）、SELECT 返回 rows、INSERT 返回 changes、DDL 执行成功、mode=crud 时返回 404、sqlAccess 拒绝返回 403、参数化查询、多语句报错
- [x] 7.2 [GREEN] 在 handleCrudRequest 开头增加 `api/db/exec` 特殊分支路由
- [x] 7.3 [GREEN] 实现 raw SQL 执行逻辑：读操作用 `db.exec(sql, params)`，写操作用 `db.run(sql, params)`
- [x] 7.4 [GREEN] 在 index.ts 注册服务关闭 hook（`app.addHook("onClose", closeAllConnections)`）
- [x] 7.5 [REFACTOR] 提取 SQL 执行结果的序列化逻辑为独立函数

## 8. Client SDK exec 方法

- [x] 8.1 [RED] 编写 client 测试：测试 LocalAppClient.exec() 调用正确端点、传参正确、错误处理
- [x] 8.2 [GREEN] 在 client.ts 实现 `LocalAppClient.exec(sql, params?)` 方法
- [x] 8.3 [GREEN] 在 react.ts 实现 `useExec()` Hook
- [x] 8.4 [GREEN] 在 index.ts 导出新方法和新 Hook
- [x] 8.5 执行 `pnpm sync:sdk` 同步到 init-repo

## 9. E2E 测试与集成验证

| Spec Scenario | E2E Test | Status |
|---|---|---|
| raw-sql-endpoint > Scenario: 执行 SELECT 查询 | e2e: raw SQL SELECT 查询 | ✓ |
| raw-sql-endpoint > Scenario: 执行 INSERT 写入 | e2e: raw SQL INSERT 写入 | ✓ |
| raw-sql-endpoint > Scenario: 执行 DDL 建表 | e2e: raw SQL DDL 建表 | ✓ |
| raw-sql-endpoint > Scenario: mode 为 crud 时拒绝 | e2e: crud 模式下拒绝 raw SQL | ✓ |
| raw-sql-endpoint > Scenario: sqlAccess 检查拒绝 | e2e: sqlAccess 权限拒绝 | ✓ |
| raw-sql-endpoint > Scenario: 路由解析正确 | e2e: api/db/exec 路由不返回 400 | ✓ |
| manifest-config > Scenario: 完整 db 配置上传 | e2e: upload 同步 dbConfig 到 meta.json | ✓ |
| manifest-config > Scenario: 无 db 字段 | e2e: 无 db 字段时默认 crud | ✓ |
| manifest-config > Scenario: crud 模式禁用 raw SQL | e2e: crud 模式下 raw SQL 返回 404 | ✓ |
| manifest-config > Scenario: sql 模式启用 raw SQL | e2e: sql 模式下 raw SQL 可用 | ✓ |
| access-control > Scenario: Schema 未配置时使用 meta.db fallback | e2e: meta.db defaultAccess fallback | ✓ |
| access-control > Scenario: Schema 配置优先级高于 meta.db | e2e: Schema RouteAccess 优先于 meta.db | ✓ |
| access-control > Scenario: sqlAccess 为 owner 时非所有者被拒 | e2e: sqlAccess owner 权限检查 | ✓ |
| client-sdk > Scenario: 执行查询类 SQL | e2e: SDK exec 查询 | ✓ |
| client-sdk > Scenario: 执行写入类 SQL | e2e: SDK exec 写入 | ✓ |

- [x] 9.1 [GREEN] 为 raw-sql-endpoint > Scenario: 执行 SELECT 查询 编写 e2e 测试
- [x] 9.2 [GREEN] 为 raw-sql-endpoint > Scenario: 执行 INSERT 写入 编写 e2e 测试
- [x] 9.3 [GREEN] 为 raw-sql-endpoint > Scenario: 执行 DDL 建表 编写 e2e 测试
- [x] 9.4 [GREEN] 为 raw-sql-endpoint > Scenario: mode 为 crud 时拒绝 编写 e2e 测试
- [x] 9.5 [GREEN] 为 raw-sql-endpoint > Scenario: sqlAccess 检查拒绝 编写 e2e 测试
- [x] 9.6 [GREEN] 为 raw-sql-endpoint > Scenario: 路由解析正确 编写 e2e 测试
- [x] 9.7 [GREEN] 为 manifest-config > Scenario: 完整 db 配置上传 编写 e2e 测试
- [x] 9.8 [GREEN] 为 manifest-config > Scenario: 无 db 字段 编写 e2e 测试
- [x] 9.9 [GREEN] 为 manifest-config > Scenario: crud 模式禁用 raw SQL 编写 e2e 测试
- [x] 9.10 [GREEN] 为 manifest-config > Scenario: sql 模式启用 raw SQL 编写 e2e 测试
- [x] 9.11 [GREEN] 为 access-control > Scenario: Schema 未配置时使用 meta.db fallback 编写 e2e 测试
- [x] 9.12 [GREEN] 为 access-control > Scenario: Schema 配置优先级高于 meta.db 编写 e2e 测试
- [x] 9.13 [GREEN] 为 access-control > Scenario: sqlAccess 为 owner 时非所有者被拒 编写 e2e 测试
- [x] 9.14 [GREEN] 为 client-sdk > Scenario: 执行查询类 SQL 编写 e2e 测试
- [x] 9.15 [GREEN] 为 client-sdk > Scenario: 执行写入类 SQL 编写 e2e 测试
- [x] 9.16 运行全部 e2e 测试，确保回归通过
- [x] 9.17 更新映射表所有 Status 为 ✓
