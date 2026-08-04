## Context

LocalApp 没有"忘记密码"自助流程。用户忘记密码后只能联系管理员，但管理员目前只能直接操作 SQLite 数据库来重置密码——没有 API 端点，也没有管理界面。需要一个管理员专用的密码重置能力。

## Goals / Non-Goals

**Goals:**
- 管理员一键重置用户密码（密码设为 userId），操作极简
- 用户下次登录时被强制要求修改密码，确保安全性
- Admin Panel 提供可视化操作界面

**Non-Goals:**
- 不做用户自助密码重置（无邮箱、无 token、无邮件发送）
- 不做邮箱绑定
- 不做 SMTP 配置

## Decisions

### 1. 密码重置为 userId

管理员点击重置后，用户密码被设为与 userId 相同，同时设置 `must_change_password = 1`。

**理由**: 管理员只需点一个按钮，不需要输入密码也不需要传递密码。用户知道自己的 userId，所以"线下告知"这一步也省了——直接告诉用户"用你的用户名当密码登录"即可。

### 2. 登录拦截 + 强制改密页面

登录时如果 `must_change_password = 1`，拒绝登录并返回特定错误码，前端跳转到 `/force-change-password` 页面。用户输入旧密码（即 userId）和新密码后，更新密码并清除标记，然后正常登录。

**理由**: 确保用户不会一直使用 userId 作为密码，改密后才能正常使用系统。

### 3. must_change_password 存储在 users 表

在 users 表新增 `must_change_password INTEGER NOT NULL DEFAULT 0` 列。

**理由**: 单文件数据库，无需额外表。标记生命周期短（重置→改密），数据量极小。

## Risks / Trade-offs

- [userId 即密码的安全隐患] → must_change_password 强制改密缓解，且 userId 公开性低（系统内部标识）
- [管理员滥用] → 已有 admin 角色校验，管理员本身就是高权限角色
