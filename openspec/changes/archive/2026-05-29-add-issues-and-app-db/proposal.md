## Why

当前平台应用缺少反馈渠道——用户访问应用后发现问题或想要新功能时，无法直接反馈。需要提供类似 GitHub Issues 的系统级 Issue 功能，让每个应用拥有独立的问题跟踪能力。

同时，现有的 `crud.db` 命名不准确——该数据库既是应用级唯一数据文件，又将在本次变更新增平台管理的 Issue 表。合并为 `app.db` 语义更清晰，统一存放应用的所有数据（用户业务表 + 平台 Issue 表）。

## What Changes

- **BREAKING**: 将 `crud-db.ts` 重命名为 `app-db.ts`，数据库文件名从 `crud.db` 改为 `app.db`
- 在 `app.db` 中新增 `_issues` 表（平台管理的系统表，`_` 前缀区分用户表），标签使用枚举字段（`bug`/`feature`）存储
- 导航栏左侧新增 Issue 按钮（CircleDot 图标），点击弹出模态框
- 模态框支持按状态（Open/Closed）和标签（bug/feature）筛选 Issue 列表
- 模态框内支持新建 Issue（标题 + 描述 + 标签）
- 提供 REST API：`GET/POST /api/issues`、`PATCH /api/issues/:id`（状态切换）
- 匿名用户可查看 Issue 列表，登录后可新建和修改
- Issue 关闭权限：创建者 + 应用 owner
- v1 不支持评论功能，后续迭代补充

## Capabilities

### New Capabilities

- `app-issues`: 应用级 Issue 功能，含 Issue 数据表、REST API、导航栏按钮、模态框 UI、权限控制

### Modified Capabilities

_无。_ 虽然 `crud-db.ts` 重命名为 `app-db.ts`，但模块对外 API 不变，不涉及 spec 级别行为变更。

## Impact

- `packages/server/src/lib/crud-db.ts` → `app-db.ts`（文件重命名 + 函数名 `getDbPath` 中文件名 `db.sqlite` → `app.db`）
- 所有引用 `crud-db.js` 的模块需更新 import 路径（`index.ts`、`serve.ts`、`schemas.ts`、`admin.ts`）
- `packages/server/src/routes/serve.ts` — `buildPlatformShell()` 新增 Issue 按钮和模态框 HTML
- 新建 `packages/server/src/routes/issues.ts` — Issue CRUD API 路由
- `packages/server/src/index.ts` — 注册 issues 路由
- `CLAUDE.md` — 更新导航栏设计说明（左侧增加 Issue 入口）
