## Why

用户忘记密码后无法自助恢复，只能联系管理员手动重置。当前系统没有管理员重置用户密码的入口，只能直接操作数据库，不够安全也不够便捷。

## What Changes

- 新增 `POST /api/admin/reset-password` 端点（管理员专用，接收 userId，将密码重置为 userId 并设置 must_change_password 标记）
- users 表新增 `must_change_password` 布尔字段
- 登录流程检测该标记，若为 true 则拒绝登录并返回提示要求修改密码
- 新增 `POST /api/auth/force-change-password` 端点（公开，接收 userId + oldPassword + newPassword，用于强制改密）
- Admin Panel 用户管理界面，管理员一键重置用户密码
- 新增 `/force-change-password` 前端页面

## Capabilities

### New Capabilities

- `password-reset`: 管理员重置用户密码——一键重置为 userId、强制用户首次登录改密、Admin Panel 操作界面

### Modified Capabilities

- `user-auth`: 登录时检测 must_change_password 标记，拒绝登录并引导改密；users 表新增 must_change_password 列

## Impact

- `packages/server/src/lib/meta-sqlite.ts` — 新增 must_change_password 列、相关查询和更新函数
- `packages/server/src/routes/auth.ts` — 新增 reset-password 端点、force-change-password 端点、登录流程增加标记检测
- `packages/server/src/routes/serve.ts` — 新增 /force-change-password SSR 页面
- Admin Panel 前端 — 新增用户管理页面（用户列表 + 一键重置按钮）
