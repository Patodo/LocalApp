## Why

当前 `/my/users` 页面只能查看用户角色，缺乏将普通用户提升为管理员或将管理员降级的入口；管理员需要直接操作数据库才能调整角色，运维成本高。

同时，系统启动时通过 `BOOTSTRAP_API_KEY` 自动创建的内置管理员账户 `id='admin'` 与角色名 `'admin'` 同名，容易混淆；且当前没有任何机制保护这个系统级管理员，任何 admin 都可以删除或（未来）降级该账户，存在单点故障风险。

## What Changes

- 在 `/my/users` 用户管理表格行内新增「切换角色」入口，按当前角色显示「提升为管理员」或「降级为用户」，采用与现有「重置密码」「删除」一致的二段式确认 UI。
- 新增后端端点 `PATCH /api/admin/users/:id/role`，接受 `{ role: "admin" | "user" }`，含自我降级保护、最后一个 admin 保护、localadmin 永久保护。
- 修改 `DELETE /api/admin/users/:id` 拒绝删除 `localadmin`。
- **BREAKING（仅新部署）**：服务启动时通过 `BOOTSTRAP_API_KEY` 创建的内置管理员 `id` 从 `'admin'` 改为 `'localadmin'`，并在数据库迁移阶段为 `localadmin` 设立永久保护标识。
- 现有部署中的 `admin` 账户保持不变（不自动迁移），仍可正常工作；管理员如希望切换到 `localadmin` 需手动操作。
- `localadmin` 用户被定义为系统级保护账户，禁止：降级为 user、删除、（未来）重命名。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `admin-api`: 新增「管理员修改用户角色」Requirement（PATCH 端点 + 自我保护 + 最后 admin 保护 + localadmin 保护）；在现有「用户管理 API」Requirement 中追加禁止删除 localadmin 的 Scenario。
- `admin-panel`: 在现有「用户管理页」Requirement 中追加「切换角色」按钮交互 Scenario 与 localadmin 行的锁定 UI Scenario。
- `admin-role`: 新增「系统保护账户 localadmin」Requirement，明确其永久 admin 状态与不可降级/删除约束；调整「bootstrap 用户自动标记为 admin」Scenario 指向 localadmin。

## Impact

- **后端代码**：
  - `packages/server/src/lib/meta-sqlite.ts`：bootstrap 创建用户从 `'admin'` 改为 `'localadmin'`；新增 `updateUserRole(id, role)`；新增 `isProtectedUserId(id)` 守卫；`everyone` 系统组的 `creator_id` 改为 `localadmin`；bootstrap API key 关联的 `user_id` 改为 `localadmin`。
  - `packages/server/src/routes/admin.ts`：新增 PATCH 路由；DELETE 路由增加 localadmin 拒绝分支；`createGroup(..., 'admin', true)` 改为 `'localadmin'`。
- **前端代码**：
  - `packages/web/app/(dashboard)/my/users/page.tsx`：行内新增「切换角色」二段式按钮；localadmin 行隐藏切换/删除按钮并展示锁标识。
- **数据库**：无 schema 变更，仅初始化数据中 `users.id`/`api_keys.user_id`/`groups.creator_id` 的字面量变化（影响仅新部署）。
- **现有部署**：`admin` 用户继续可用，不会自动迁移；管理员如需切换到 `localadmin` 需手动操作（本变更不提供迁移工具）。
- **测试**：新增集成测试覆盖 PATCH 端点的各保护分支；新增/调整 admin 基线测试中 bootstrap 用户名从 `admin` 改为 `localadmin`。
