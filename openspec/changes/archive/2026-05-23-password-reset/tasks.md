## 1. 数据层

- [x] 1.1 在 `meta-sqlite.ts` 的 `initMetaDb` 迁移块中添加 `must_change_password INTEGER NOT NULL DEFAULT 0` 列检测和 ALTER TABLE
- [x] 1.2 在 `UserRow` 和 `UserRecord` 接口中添加 `mustChangePassword` 字段
- [x] 1.3 在 `toUserRecord` 中添加 mustChangePassword 映射
- [x] 1.4 更新所有 SELECT users 查询添加 must_change_password 列
- [x] 1.5 新增 `resetUserPassword(userId: string): void` 函数 — bcrypt(userId) + set must_change_password = 1
- [x] 1.6 新增 `clearMustChangePassword(userId: string): void` 函数
- [x] 1.7 新增 `listAllUsers(page, limit)` 函数（管理员查看全部用户，含 mustChangePassword）

## 2. API 端点

- [x] 2.1 在 `auth.ts` 中添加 `POST /api/admin/reset-password` 端点（校验 admin、用户存在性、provider 非 system、调用 resetUserPassword）
- [x] 2.2 在 `auth.ts` 中添加 `GET /api/admin/users` 端点（校验 admin、调用 listAllUsers、返回分页结果）
- [x] 2.3 在 `auth.ts` 中添加 `POST /api/auth/force-change-password` 端点（校验旧密码、新密码长度、更新密码、清除标记、签发 JWT）
- [x] 2.4 修改登录端点：验证 must_change_password 标记，为 true 时返回 403 + MUST_CHANGE_PASSWORD 错误码

## 3. 前端页面

- [x] 3.1 在 `serve.ts` 中添加 `GET /force-change-password` SSR 页面（userId + 旧密码 + 新密码表单）
- [x] 3.2 修改登录页 JS：检测 MUST_CHANGE_PASSWORD 错误码后跳转到 `/force-change-password`

## 4. Admin Panel

- [x] 4.1 添加用户管理页面（用户列表表格：用户名、角色、注册时间、是否待改密状态）
- [x] 4.2 添加"重置密码"按钮和确认弹窗，调用 `POST /api/admin/reset-password`

## 5. 测试

- [x] 5.1 新建 `tests/e2e/admin-reset-password.test.ts` — 覆盖管理员重置、非管理员拒绝、用户不存在、system 用户拒绝、登录拦截、强制改密成功、强制改密失败
