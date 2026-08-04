## REMOVED Requirements

### Requirement: Raw SQL 执行端点

**Reason**: 应用层数据通道统一为 named SQL。原始 SQL 端点（`POST /serve/{userId}/{pageName}/api/db/exec`）允许前端直接执行任意 SQL，与"前端只能调用 backend 契约中声明的 named SQL"原则冲突，整体移除。

**Migration**: 应用必须为每个数据操作在 `backend/resources/<resource>/{queries,mutations}.json` 中声明 named SQL。前端通过 `client.query(name, params)` / `client.mutate(name, params)` 调用。需要执行一次性数据修复或迁移时，由应用 owner 在服务端直接操作 SQLite 文件。

### Requirement: Raw SQL 长连接常驻

**Reason**: 该 requirement 描述的是 raw SQL 与 CRUD 共享 SQLite 长连接。raw SQL 端点移除后，长连接管理归属于 named SQL 执行器的基础设施，不再作为独立 capability requirement。

**Migration**: SQLite 长连接管理继续由 named SQL 执行器（`packages/server/src/lib/app-db.ts`）维护，行为不变（多次请求复用连接、写后立即持久化、空闲超时关闭、服务关闭时落盘）。该行为属于内部实现细节，不再作为应用 API 层的 spec requirement。
