## Why

首次登录强制改密时，用户刚刚在登录弹窗输入过密码并被服务端验证通过，紧接着又被迫在改密弹窗里**再次输入同样的"当前密码"**。这是冗余的身份证明——服务端虽然没下发 token，但 LoginDialog 已经知道密码是有效的。这个二次输入步骤增加了首次登录的摩擦，也让用户怀疑流程是否出错（"我不是刚输过吗？"）。

## What Changes

- LoginDialog 在收到 `MUST_CHANGE_PASSWORD` 响应时，把刚验证过的 `password` 暂存到 `AuthProvider` 上下文中（内存中，不持久化），再切换到 ChangePasswordDialog force 模式
- ChangePasswordDialog **force 模式下隐藏"当前密码"输入框**，仅展示"新密码"和"确认新密码"两个字段；提交时从 `AuthProvider` 取暂存的 `oldPassword` 一并发送给服务端
- ChangePasswordDialog **profile 模式保持不变**（仍要求用户输入当前密码作为二次校验，因为该模式下没有"刚登录"的上下文）
- 服务端 `POST /api/auth/force-change-password` 端点签名不变（仍接受 `{ userId, oldPassword, newPassword }`），保证 API 契约稳定
- 用户若刷新页面或直接打开 force 弹窗（无登录上下文），由于 `oldPassword` 缺失，提交将失败——这是预期行为，因为这种路径本来就不该走通

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `auth-modals`: ChangePasswordDialog force 模式 UI 变更（隐藏"当前密码"字段）；LoginDialog 在 `MUST_CHANGE_PASSWORD` 时透传 password 给 AuthProvider；AuthProvider 新增 password 暂存状态

## Impact

- **前端代码**：
  - `packages/web/components/auth-modals/auth-provider.tsx`：新增 `pendingOldPassword` state 和 setter
  - `packages/web/components/auth-modals/login-dialog.tsx`：`MUST_CHANGE_PASSWORD` 分支调用新的 setter
  - `packages/web/components/auth-modals/change-password-dialog.tsx`：force 模式条件渲染 oldPassword 输入框；提交逻辑从 context 取值
- **服务端代码**：无改动（端点签名、行为完全不变）
- **测试**：
  - 现有 force-change-password 集成测试保持通过（API 未变）
  - 新增/更新前端测试覆盖 force 模式隐藏字段的行为
- **依赖**：无新增依赖
- **风险**：低。`password-reset` 主规格的 API 契约未变，回滚只需还原前端三个文件
