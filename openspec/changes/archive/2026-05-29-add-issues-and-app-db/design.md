## Context

当前平台每个应用拥有独立的 `crud.db`（通过 `crud-db.ts` 管理连接和用户表 CRUD）。本次变更做两件事：

1. 将 `crud.db` / `crud-db.ts` 重命名为 `app.db` / `app-db.ts`，统一应用数据库的语义
2. 在 `app.db` 中新增 Issue 系统表，通过平台级 API 提供 Issue 功能

Issue 数据属于应用而非平台，因此存储在应用目录下的 `app.db` 中。Issue 表使用 `_` 前缀（`_issues`、`_issue_labels`）与用户自定义表区分，避免命名冲突。

## Goals / Non-Goals

**Goals:**
- 重命名 `crud-db.ts` → `app-db.ts`，文件名 `crud.db` → `app.db`，保持对外 API 不变
- 在 `app-db.ts` 中新增 Issue 相关的数据库操作函数（建表、增删改查）
- 提供平台级 REST API（`/api/issues`）用于 Issue 浏览和操作
- 导航栏左侧添加 Issue 按钮，弹出模态框展示和创建 Issue
- 支持 bug/feature 标签、Open/Closed 状态筛选
- 权限控制：匿名可查看，登录后可创建，关闭仅限创建者或应用 owner

**Non-Goals:**
- 评论/讨论功能（后续迭代）
- Issue 指派人（Assignee）
- Issue 里程碑（Milestone）
- Markdown 富文本编辑
- 邮件/通知提醒

## Decisions

### 1. app.db 合并存储

**选择**: 将 `crud.db` 重命名为 `app.db`，用户业务表和平台 Issue 表共用一个数据库文件。

**原因**: 每个应用只需一个数据文件，减少连接管理复杂度。平台管理的 Issue 表使用 `_issues`、`_issue_labels` 命名，`_` 前缀在下划线命名法中带来视觉区分，避免与用户表（通常不含前导下划线）冲突。

**备选方案**: 独立的 `issues.db` 文件。被否决，因为增加了文件数和连接管理，与用户倾向不一致。

### 2. 模块内嵌 Issue 函数

**选择**: Issue 数据库操作函数（建表、CRUD）直接写在 `app-db.ts` 中。

**原因**: `app-db.ts` 已管理所有 app.db 连接，Issue 操作复用同一套连接池和持久化逻辑。独立文件会增加不必要的模块边界。

**备选方案**: 新建独立的 `issues-db.ts`。被否决，因为连接管理逻辑重复且职责重叠。

### 3. 平台级 API 路径

**选择**: Issue API 注册在平台级（如 `/api/issues?pagePath=...`），而非 `/:userId/:name/api/issues`。

**原因**: 与收藏（`/api/favorites`）和历史（`/api/history`）的 API 模式保持一致。路径中通过 `pagePath` 查询参数指定应用，再由 `storage.getPageDir()` 解析为 `app.db` 路径。

**备选方案**: 挂在应用路径下 `/:userId/:name/api/issues`。实现更复杂，需修改 serve.ts 的路由分发逻辑。v1 采用简单方案。

### 4. 模态框 UI

**选择**: 在 `buildPlatformShell()` 生成的 HTML 中内嵌模态框（inline HTML + CSS + JS），通过 API 调用加载数据。

**原因**: 沿用平台现有模式（favorites 页面、login 页面均为服务端渲染 HTML + 内嵌 JS）。模态框初始隐藏，点击 Issue 按钮时显示，点击遮罩或关闭按钮时隐藏。无需引入前端框架。

### 5. 权限模型

**选择**: 
- 查看 Issue 列表：公开（无需登录）
- 创建 Issue：需要登录
- 关闭/重开 Issue：创建者或应用 owner

**原因**: 与 GitHub Issues 权限模型一致。无需登录限制查看降低了反馈门槛。通过 `findUserById` 查询当前用户是否为 app owner。

### 6. Label 设计

**选择**: 标签使用枚举值（`bug`、`feature`），直接存储在 `_issues.label` TEXT 字段中。

**原因**: v1 只有两种标签，枚举字段足够。后续若需扩展标签，可引入 `_issue_labels` 关联表。当前方案保持简单。

## Risks / Trade-offs

- **[R] 数据库重命名导致旧数据不兼容**: 现有应用的 `crud.db` 文件不会被自动重命名。→ 在 `getDbPath()` 中检查 `app.db` 是否存在，如不存在则回退读取 `crud.db`（向后兼容）。新写入统一使用 `app.db`。
- **[R] `_` 前缀无法完全避免表名冲突**: 用户理论上可以创建以 `_` 开头的表名。→ `_issues` 和 `_issue_labels` 是双重下划线级的保留名，冲突概率极低。若冲突，平台报错提示。
- **[R] Issue 删除后编号不连续**: 与 GitHub 行为一致（Issue 编号不回收），可接受。

## Migration Plan

1. 部署新版本
2. 服务器启动时检查应用目录下是否存在 `crud.db` 但无 `app.db`，自动重命名
3. 新创建的应用直接使用 `app.db`
4. 旧应用继续工作（数据库文件透明升级）
