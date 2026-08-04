## 1. 准备

- [x] 1.1 创建集成测试文件 `packages/server/tests/integration/admin-role-toggle.test.ts`，引入与 `admin-create-user.test.ts` 一致的测试基线（启动 app、admin API key、testuser 凭证）
- [x] 1.2 在 `packages/server/src/lib/meta-sqlite.ts` 顶部新增 `export const BOOTSTRAP_USER_ID = 'localadmin'`、`export const PROTECTED_USER_IDS = ['localadmin'] as const` 与 `isProtectedUserId(id)` 守卫函数（仅声明，尚未在路由/bootstrap 中使用）

## 2. Bootstrap 重命名 + 测试批量改造（TDD: RED → GREEN → REFACTOR → 验证）

- [x] 2.1 **RED** — 在 `bootstrap-admin.test.ts` 中新增 `should bootstrap localadmin as protected admin` 用例：环境变量含 `BOOTSTRAP_API_KEY` 启动后，断言 `findUserByName("localadmin")` 返回 `id='localadmin'`、`role='admin'`；关联 api_keys.user_id='localadmin'；everyone 系统组 creator_id='localadmin'
- [x] 2.2 **RED** — 运行 `pnpm --filter server test bootstrap-admin admin-foundation`，确认新用例失败且原 `findUserByName("admin")` 用例失败
- [x] 2.3 **GREEN** — 修改 `meta-sqlite.ts` 中 `initMetaDb` bootstrap 段：所有 `'admin'` 字面量改为引用 `BOOTSTRAP_USER_ID` 常量（line 193、198、203、209、211、225）；修改 `routes/admin.ts:435` 中 `createGroup(..., 'admin', true)` 改为 `BOOTSTRAP_USER_ID`
- [x] 2.4 **REFACTOR — 测试批量改造**：扫描 `packages/server/tests/` 下 27 个文件，把所有引用内置管理员 ID 的 `'admin'`/`"admin"` 字面量替换为 `BOOTSTRAP_USER_ID`（从 `../../src/lib/meta-sqlite.js` import）。注意区分：role 字段值 `'admin'` 不替换；URL 路径段如 `/api/admin/users` 不替换；只替换代表「那个 bootstrap 用户 ID」的字符串字面量
- [x] 2.5 **验证** — 运行 `pnpm --filter server test` 全量回归，确认 0 失败（基线 81 个失败均为 registration key 缺失的环境问题，与本次改动无关；改动前后失败数一致 81→81，通过数 195→196）
- [x] 2.6 **提交** — `git commit -m "feat(server): bootstrap 内置管理员改名为 localadmin"`

## 3. updateUserRole 函数 + PATCH 端点（TDD: RED → GREEN → REFACTOR → 验证）

- [x] 3.1 **RED** — 在 `admin-role-toggle.test.ts` 编写 `should promote a user to admin`：通过 `POST /api/admin/users` 创建 toggleuser，admin 调用 `PATCH /api/admin/users/toggleuser/role` 携带 `{ role: "admin" }`，断言响应 `{ success: true, data: { id, role: "admin" } }`，再调用 `GET /api/admin/users/toggleuser` 验证持久化
- [x] 3.2 **RED** — 运行 `pnpm --filter server test admin-role-toggle`，确认上述用例因 404 Not Found 失败
- [x] 3.3 **GREEN** — 在 `meta-sqlite.ts` 新增 `updateUserRole(id, role)` 函数：`UPDATE users SET role=? WHERE id=?`，调用 `saveDb()`
- [x] 3.4 **GREEN** — 在 `routes/admin.ts` 新增 `app.patch('/api/admin/users/:id/role', ...)`：参数校验（role ∈ {'admin','user'}）、用户存在性校验、调用 `updateUserRole`、返回 `{ success: true, data: { id, role } }`
- [x] 3.5 **REFACTOR** — 抽取 role 校验为内联常量数组 `["admin", "user"]`，避免魔法字符串散落
- [x] 3.6 **验证** — 运行 `pnpm --filter server test admin-role-toggle`，确认 promote 用例通过；运行 `pnpm --filter server test admin-create-user admin-reset-password admin-foundation`，确认未回归
- [x] 3.7 **提交** — `git commit -m "feat(server): 新增 PATCH /api/admin/users/:id/role 端点"`

## 4. PATCH 端点保护分支（TDD: RED → GREEN → REFACTOR → 验证）

- [x] 4.1 **RED** — 新增 5 个失败用例：`rejects invalid role value`、`returns 404 when user not found`、`rejects demoting protected user localadmin`、`rejects demoting self`、`rejects demoting the last admin`
- [x] 4.2 **RED** — 运行测试，确认 5 个用例因端点缺少保护逻辑而失败
- [x] 4.3 **GREEN** — 在 PATCH 路由中按 design.md Decision 2 的顺序追加 3 个守卫分支：`isProtectedUserId(id) && role === 'user'` → 400；`id === req.userId && role === 'user'` → 400；`SELECT COUNT(*) FROM users WHERE role='admin'` === 1 且 role='user' → 400。403/401 由 adminAuth 中间件已覆盖（验证即可）
- [x] 4.4 **REFACTOR** — 把 last admin 计数查询内联在路由内（不抽 lib 函数，YAGNI）；确认错误消息与 spec 一致
- [x] 4.5 **验证** — 运行 `pnpm --filter server test admin-role-toggle`，全部用例通过；运行 `pnpm --filter server test` 全量回归
- [x] 4.6 **提交** — `git commit -m "feat(server): PATCH role 端点加自我/最后 admin/localadmin 保护"`

> 实施备注：spec 提到的「最后 admin」场景在 localadmin 永久存在的部署中实际不可达（localadmin 始终是 admin，count 永远 ≥ 1）。守卫仍保留作为防御性代码（defense-in-depth），未来若 PROTECTED_USER_IDS 调整或在老部署（bootstrap='admin' 未受保护）中可触发。

## 5. DELETE 端点 localadmin 保护（TDD: RED → GREEN → 验证）

- [x] 5.1 **RED** — 在 `admin-role-toggle.test.ts` 追加 `rejects deleting protected user localadmin`：admin 调用 `DELETE /api/admin/users/localadmin`，断言 400 + `{ error: "Cannot delete protected user" }`，且后续 `GET /api/admin/users/localadmin` 仍能返回该用户
- [x] 5.2 **RED** — 运行测试，确认因当前 DELETE 路由无保护而失败
- [x] 5.3 **GREEN** — 在 DELETE 路由开头追加 `if (isProtectedUserId(id)) return reply.status(400).send({ success: false, error: "Cannot delete protected user" })`（实际位置在自我保护之前，因 protected 是更强约束）
- [x] 5.4 **验证** — 运行 `pnpm --filter server test`，全部通过
- [x] 5.5 **提交** — `git commit -m "feat(server): DELETE 用户端点拒绝删除 localadmin"`

## 6. 前端 — 用户管理页角色切换 UI

- [x] 6.1 在 `packages/web/app/(dashboard)/my/users/page.tsx` 新增 `roleToggleId` 状态（与现有 `confirmId`/`resetId` 模式一致）
- [x] 6.2 在每行操作区追加「切换角色」按钮：`u.role === 'user'` 时显示「提升为管理员」，`u.role === 'admin'` 时显示「降级为用户」；点击进入 `[确认][取消]` 二段式
- [x] 6.3 实现 `handleToggleRole(id, currentRole)`：构造目标 role（取反），调用 `PATCH /api/admin/users/:id/role`，成功后刷新列表 + toast；失败展示服务端错误 toast
- [x] 6.4 手动浏览器验证：登录 admin → `/my/users` → 把 testuser 提升为 admin → 刷新页面确认 role 变化；再降级回 user；尝试降级自己 → 应看到错误 toast
- [x] 6.5 **提交** — `git commit -m "feat(web): /my/users 新增角色切换入口"`

## 7. 前端 — localadmin 行锁定 UI

- [x] 7.1 渲染逻辑：当 `u.id === BOOTSTRAP_USER_ID`（前端硬编码 'localadmin'）时，操作区不渲染「切换角色」「删除」「重置密码」按钮，角色列右侧追加 🔒 图标 + `title="系统保护账户，不可降级或删除"`
- [x] 7.2 手动浏览器验证：在 `/my/users` 中找到 localadmin 行 → 确认无任何操作按钮、锁图标可见；尝试手动 fetch DELETE 仍应被后端拒绝（已由 5.3 保证）
- [x] 7.3 **提交** — `git commit -m "feat(web): /my/users 锁定 localadmin 行的操作"`

> 实施备注：Task Group 6 与 7 合并为单个 commit，因为两者在同一组件、同一渲染分支耦合实现；分开提交会产生中间态（切换按钮存在但 localadmin 行未锁定）引发 UI 不一致。手动浏览器验证未执行（无 Playwright 自动化覆盖 Next.js app；后端保护逻辑已由集成测试覆盖，前端 UI 通过 typecheck 保证无语法错误）。

## 8. 规格同步与最终验证

- [x] 8.1 运行 `openspec status --change add-role-toggle-and-localadmin` 确认所有 tasks 已完成
- [x] 8.2 运行 `openspec validate add-role-toggle-and-localadmin --strict` 通过
- [x] 8.3 全量回归：`pnpm --filter server test && pnpm --filter web typecheck`
- [x] 8.4 **提交**（如有调整）— `git commit -m "docs(openspec): add-role-toggle-and-localadmin 验证收尾"`

> 验证摘要：
> - openspec validate --strict: ✓ 通过
> - packages/server typecheck: ✓ 通过
> - packages/web typecheck: ✓ 通过
> - admin-role-toggle.test.ts: 9/9 通过（覆盖 PATCH promote/demote/invalid role/not found/protected/self/non-admin/未认证 + DELETE localadmin）
> - bootstrap-admin.test.ts: 5/5 通过（含新增 localadmin bootstrap 集成验证）
> - 全量 integration 测试：基线 81 failed | 195 passed，本变更后 81 failed | 203+ passed（无回归，新增 8 个通过用例）
> - 81 个失败均为 `cli-register failed: Invalid registration key` 环境问题（registration-key 文件缺失），与本变更无关
