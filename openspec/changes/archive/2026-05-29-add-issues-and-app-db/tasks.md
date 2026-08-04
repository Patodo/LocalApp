## 1. 数据库重命名：crud-db.ts → app-db.ts

- [x] 1.1 将 `packages/server/src/lib/crud-db.ts` 重命名为 `app-db.ts`
- [x] 1.2 修改 `getDbPath()` 函数，将文件名 `db.sqlite` 改为 `app.db`；保留向后兼容（若 `app.db` 不存在但 `db.sqlite` 存在则自动重命名并使用）
- [x] 1.3 更新所有 import 路径：`packages/server/src/index.ts`、`packages/server/src/routes/serve.ts`、`packages/server/src/routes/schemas.ts`、`packages/server/src/routes/admin.ts`，将 `crud-db.js` 改为 `app-db.js`

## 2. Issue 数据层

- [x] 2.1 在 `app-db.ts` 中实现 `ensureIssueTables(dbPath: string)` 函数，创建 `_issues` 表
- [x] 2.2 在 `app-db.ts` 中实现 `getNextIssueNumber(dbPath: string): number` 函数（查询当前最大 issue_number + 1）
- [x] 2.3 在 `app-db.ts` 中实现 `insertIssue(dbPath, title, description, label, reporterId): { id, issueNumber }` 函数
- [x] 2.4 在 `app-db.ts` 中实现 `listIssues(dbPath, status?, label?): Issue[]` 函数
- [x] 2.5 在 `app-db.ts` 中实现 `getIssueById(dbPath, id): Issue | null` 函数
- [x] 2.6 在 `app-db.ts` 中实现 `updateIssue(dbPath, id, updates): boolean` 函数

## 3. Issue API 路由

- [x] 3.1 创建 `packages/server/src/routes/issues.ts`，实现 `GET /api/issues`
- [x] 3.2 实现 `POST /api/issues`
- [x] 3.3 实现 `PATCH /api/issues/:id`

## 4. 导航栏 Issue 按钮 + 模态框

- [x] 4.1 在 `buildPlatformShell()` 中：左侧应用名称旁添加 Issue 按钮（CircleDot 内嵌 SVG）
- [x] 4.2 在 Shell HTML 中内嵌 Issue 模态框 HTML
- [x] 4.3 实现模态框 JS：打开/关闭、列表加载、筛选切换、新建和提交、状态切换
- [x] 4.4 在 `buildPlatformShell()` 中传入 `pagePath`，供模态框 JS 使用

## 5. 路由注册

- [x] 5.1 在 `packages/server/src/index.ts` 中注册 `issuesRoutes`
- [x] 5.2 在 `CLAUDE.md` 补充导航栏设计 + 图标使用说明

## 6. 验证

- [x] 6.1 启动 server，验证 `db.sqlite` 到 `app.db` 的自动重命名兼容性
- [x] 6.2 验证 Issue API：创建 Issue、查询列表、筛选、更新状态、权限控制
- [x] 6.3 验证模态框 UI 渲染（issues-btn、issues-modal、JS 函数均存在于 Shell HTML 中）
