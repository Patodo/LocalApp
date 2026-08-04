## 1. 数据模型与角色基座

- [x] 1.1 `meta-sqlite.ts` users 表新增 `role TEXT NOT NULL DEFAULT 'user'` 列，新增 `getUserRole(id)`、`listUsers(page, limit)`、`getUserDetail(id)`、`deleteUser(id)` 函数
- [x] 1.2 `types/models.ts` User 类型新增 `role: 'admin' | 'user'` 字段
- [x] 1.3 `meta-sqlite.ts` initMetaDb 中自动将 `id='admin'` 的用户 role 设为 `'admin'`

## 2. 认证/授权扩展

- [x] 2.1 `routes/auth.ts` 注册流程：确保新用户 role='user'，注册响应包含 role
- [x] 2.2 `routes/auth.ts` 登录流程：JWT payload 新增 `role` 字段（从库中读取）
- [x] 2.3 `plugins/session.ts` 解析 JWT 后设置 `req.visitorRole`（可选，或后续查库）
- [x] 2.4 `plugins/auth.ts` 新增 `adminAuth` 中间件：查库验证 role=admin，导出供路由注册使用
- [x] 2.5 `routes/auth.ts` `/api/me` 响应包含 role 字段

## 3. 管理 API

- [x] 3.1 新建 `routes/admin.ts`，注册 adminAuth 中间件，实现 `GET /api/admin/users`（分页列表，含 pages 数和 storageUsed）
- [x] 3.2 `GET /api/admin/users/:id` 用户详情（含关联页面摘要）
- [x] 3.3 `DELETE /api/admin/users/:id` 删除用户（清理目录 + API keys + 用户记录），禁止删除自己
- [x] 3.4 `GET /api/admin/pages` 全局页面列表（遍历 data/ 目录，支持 userId 过滤和分页）
- [x] 3.5 `GET /api/admin/pages/:userId/:name` 页面详情（完整 meta + 版本 + 存储用量）
- [x] 3.6 `DELETE /api/admin/pages/:userId/:name` 删除页面（关闭 DB 连接 + 删除目录）
- [x] 3.7 `GET /api/admin/stats` 系统概览统计

## 4. 服务端路由注册

- [x] 4.1 `index.ts` 注册 admin 路由组（在 authPlugin 后注册，路径 `/api/admin`）

## 5. CLI admin 命令

- [x] 5.1 `main.rs` 新增 `Admin` 子命令，含 `Users`、`Pages`、`Stats` 三个子动作
- [x] 5.2 新建 `commands/admin.rs`，实现 `admin users`（调用 GET /api/admin/users，输出 JSON 表格）
- [x] 5.3 实现 `admin pages`（调用 GET /api/admin/pages）
- [x] 5.4 实现 `admin stats`（调用 GET /api/admin/stats）

## 6. e2e 测试

- [x] 6.1 `tests/e2e/admin-foundation.test.ts`：测试 admin 角色校验（非 admin 访问返回 403）
- [x] 6.2 测试用户管理 API（列表、详情、删除）
- [x] 6.3 测试页面管理 API（全局列表、详情、删除）
- [x] 6.4 测试 stats API 返回正确聚合数据

## 7. 收尾

- [x] 7.1 cargo check + cargo build 验证
- [x] 7.2 提交所有变更
