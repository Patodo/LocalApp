## 1. RED — 基线确认

- [x] 1.1 运行 `pnpm test`（或 `pnpm --filter @localapp/server test`）确认现有集成测试基线全绿（特别关注 `auth.test.ts`、`admin-reset-password.test.ts`、`admin-foundation.test.ts`、`provider-cleanup.test.ts`、`global-auth.test.ts` 中所有 `force-change-password` 相关用例）
- [x] 1.2 手动复现当前问题：启动 dev server，用 admin 账号 reset 某 testuser 的密码 → 退出登录 → 在 LoginDialog 用 testuser / testuser 登录 → 观察到 `MUST_CHANGE_PASSWORD` 触发的 force 改密弹窗**仍要求填写"当前密码"**（作为变更前的对照证据）
- [x] 1.3 提交基线快照（如有需要，例如新增了 e2e 复现脚本）：`fix:` 或 `test:` 前缀，否则跳过本步

## 2. GREEN — 实施变更

- [x] 2.1 修改 `packages/web/components/auth-modals/auth-provider.tsx`：在 Context 中新增 `pendingOldPassword: string | null` state、`setPendingOldPassword` 方法；在 `closeChangePassword` 中除了关闭弹窗外**同时清空 `pendingOldPassword`**；导出新的类型字段
- [x] 2.2 修改 `packages/web/components/auth-modals/login-dialog.tsx`：在 `body.code === "MUST_CHANGE_PASSWORD"` 分支中，**在 closeLogin / openChangePassword 之前**调用 `setPendingOldPassword(password)`，把用户刚输入的密码写入 context
- [x] 2.3 修改 `packages/web/components/auth-modals/change-password-dialog.tsx`：
  - 从 `useAuthModals()` 解构出 `pendingOldPassword`
  - 用 `{!isForce && (<div>...当前密码输入框...</div>)}` 条件渲染——profile 模式照常显示，force 模式隐藏整个 oldPassword 输入块
  - force 模式提交时，`oldPassword` 取自 `pendingOldPassword`（而非 FormData），构造 payload `{ userId: changePasswordUserId, oldPassword: pendingOldPassword, newPassword }`
  - profile 模式逻辑完全保持不变
- [x] 2.4 运行 `pnpm --filter @localapp/web build` 确认 TypeScript 编译通过（无类型错误、无未使用变量告警）
- [x] 2.5 提交 GREEN：`feat(web): 首次登录强制改密去掉当前密码字段`

## 3. 验证 — 全量回归

- [x] 3.1 手动验证主路径（force 模式）：admin reset testuser → 退出 → 用 testuser / testuser 登录 → force 弹窗**只显示"新密码"和"确认新密码"两个字段，无"当前密码"** → 输入有效新密码 → 提交 → 弹窗关闭 + 跳转首页 + 已登录状态
- [x] 3.2 手动验证 profile 模式回归：以已登录用户身份进入 `/my/info` 触发改密 → 弹窗**仍显示三个字段**（当前密码 + 新密码 + 确认密码）→ 流程不变
- [x] 3.3 手动验证密码不一致保护：force 模式下输入两次不一致的新密码 → 提交 → 弹窗显示"两次密码不一致"且**保持打开**（不关闭、不跳转）
- [x] 3.4 手动验证暂存密码缺失的边界：force 弹窗打开后**刷新页面** → 弹窗消失 → 重新走登录流程（验证无残留状态泄漏）
- [x] 3.5 手动验证刷新提交失败的边界（可选，需 DevTools 协助）：用 DevTools 在 force 弹窗打开时清空 context 的 `pendingOldPassword`，再提交 → 服务端返回 401 → 弹窗显示错误且保持打开
- [x] 3.6 运行 `pnpm test` 确认所有集成测试通过（API 契约未变，应当全绿）
- [x] 3.7 提交验证收尾（如有 e2e 复现脚本或截图文档）：`docs:` 或 `test:` 前缀；无文件改动则跳过

## 4. 归档准备

- [x] 4.1 检查 `openspec/changes/simplify-force-change-password/` 下四件制品齐全且与实现一致
- [x] 4.2 走 `/opsx-achieve`（或 `/merge-review` 后 `/opsx-achieve`）同步主规格并归档变更
