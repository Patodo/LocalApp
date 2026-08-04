## Context

当前用户管理页面 (`/my/users`) 仅展示用户列表，行内操作只有「重置密码」「删除」两个动作。后端 `admin.ts` 也没有修改用户角色的端点，管理员若要调整角色必须直接操作 SQLite。

系统启动时由 `BOOTSTRAP_API_KEY` 触发的内置管理员账户 `id='admin'` 存在两个问题：
1. **命名混淆**：用户 ID `'admin'` 与角色值 `'admin'` 同名，日志、URL、代码阅读时易混淆。
2. **缺乏保护**：任何 admin 都可以删除这个内置账户，导致单点故障（系统再无 admin 时所有 `/api/admin/*` 请求 403）。

约束：
- 后端基于 Fastify + sql.js，admin 鉴权中间件每次请求查 `users.role`，**不信任 JWT 中的 role**，因此 role 变更即时生效。
- 前端为 Next.js App Router，用户管理页是单一 `page.tsx` 文件，已有「重置密码」「删除」的二段式确认模式可复用。
- 已有部署中存在 `id='admin'` 用户、`data/admin/` 数据目录、`api_keys.user_id='admin'` 关联记录。用户决定**不自动迁移**，新部署才创建 `localadmin`。

## Goals / Non-Goals

**Goals:**
- 在 `/my/users` 页面提供 role 切换入口，UI 与现有行内操作风格一致。
- 后端提供安全的 role 切换 API，含自我保护、最后 admin 保护、localadmin 保护三层防御。
- 将新部署的内置管理员 ID 改为 `localadmin`，并将其设为永久保护账户（不可降级、不可删除、未来不可重命名）。
- 现有部署不受影响，`admin` 账户继续按当前行为运行。

**Non-Goals:**
- 不提供从 `admin` 自动迁移到 `localadmin` 的工具或脚本（用户决定保留旧部署不变）。
- 不引入 user rename API（目前不存在），因此 localadmin 的「不可重命名」保护属于前瞻性约束，通过 `isProtectedUserId` 单点守卫，未来若加 rename 端点时复用即可。
- 不修改 JWT 中 role 字段的语义（继续随登录签发，但中间件不信任它）。
- 不修改密码策略，localadmin 的密码遵循现有 `BOOTSTRAP_API_KEY`/`ADMIN_DEFAULT_PASSWORD` 逻辑。

## Decisions

### Decision 1: API 形态 — `PATCH /api/admin/users/:id/role`

**选择**: 单字段端点 `PATCH /api/admin/users/:id/role`，请求体 `{ role: "admin" | "user" }`。

**理由**:
- 与现有 `/api/admin/reset-password`（动作型 POST）和 `/api/admin/users/:id`（资源型）两种风格相比，PATCH + 子资源更精确表达「局部更新 role 字段」。
- RESTful 风格，未来若要支持改 `name`/`display_name` 可以扩展为 `PATCH /api/admin/users/:id`，但当前不做。

**备选**:
- `PUT /api/admin/users/:id` 全量更新 — 拒绝，需要前端送全字段，与现有页面表单不匹配。
- `POST /api/admin/users/:id/role` 动作型 — 拒绝，PATCH 更符合「修改字段」语义。

### Decision 2: 三层保护顺序 — 参数校验 → 实体存在 → localadmin → 自我 → 最后 admin

**选择**: 按以下顺序短路返回，避免逻辑交织：

```
1. role 非法值 (不是 'admin'/'user')              → 400 Invalid role
2. 目标用户不存在                                  → 404 User not found
3. isProtectedUserId(id) === true 且目标 role='user' → 400 Cannot demote protected user
4. id === req.userId 且目标 role='user'             → 400 Cannot demote yourself
5. 目标 role='user' 且 admin 总数 == 1              → 400 Cannot demote the last admin
6. 通过 → UPDATE users SET role=? WHERE id=?
```

**理由**:
- 校验顺序从「便宜」到「贵」（DB 查询越靠后）。
- localadmin 检查放在自我检查之前，因为 localadmin 永远是 admin，永远不会触发「降级自己」的分支，但放在前面更清晰。

**备选**:
- 把所有检查写在路由 handler 里 — 拒绝，将来要在 DELETE/未来 rename 中复用 `isProtectedUserId` 守卫，提取到 lib 层更干净。

### Decision 3: `isProtectedUserId` 单点守卫

**选择**: 在 `meta-sqlite.ts` 新增：
```ts
export const PROTECTED_USER_IDS = ["localadmin"] as const;
export function isProtectedUserId(id: string): boolean {
  return PROTECTED_USER_IDS.includes(id as any);
}
```

**理由**:
- 把「哪些用户 ID 是系统保护账户」收敛到一处常量，未来若要扩展（如再加 `support`）只需改一处。
- DELETE 路由、PATCH 路由、未来的 rename 路由都通过 `isProtectedUserId` 判断。

**备选**:
- 在 users 表加 `is_protected` 列 — 拒绝，过度设计；保护账户是部署级常量，不是数据级属性。
- 在代码里硬编码 `id === 'localadmin'` — 拒绝，散落多处易漏。

### Decision 4: 内置管理员 ID `'admin'` → `'localadmin'`（仅 bootstrap，抽常量）

**选择**: 在 `meta-sqlite.ts` 顶部导出常量 `BOOTSTRAP_USER_ID = 'localadmin'`，所有引用内置管理员 ID 的位置（含 `initMetaDb` 的 bootstrap 逻辑与 27 个测试文件中的 fixture 字面量）改为引用该常量。

具体替换点：
- `api_keys.user_id = BOOTSTRAP_USER_ID`
- `users.id/name = BOOTSTRAP_USER_ID`
- `groups.creator_id = BOOTSTRAP_USER_ID`（everyone 系统组）
- `routes/admin.ts` 中 `createGroup(..., 'admin', true)` → `BOOTSTRAP_USER_ID`
- 测试套件中 `createTestPage(app, "admin", ...)`、`findUserByName("admin")`、`crudUrl(baseUrl, "admin", ...)` 等 → 引用 `BOOTSTRAP_USER_ID`

**理由**:
- 抽常量后字面量只出现一次，未来若再改名（或对部署环境做差异化）只需改一处。
- 27 个测试文件批量替换有 commit 噪音，但语义清晰且未来防回归。
- 用户决策「只新部署生效」，不写运行时迁移。

**备选**:
- 直接散落字面量替换（不抽常量） — 拒绝，未来改名成本高。
- 添加启动时迁移逻辑（如 `admin` 存在则改名为 `localadmin`） — 拒绝（用户决定不做）。
- 保留 `admin` 作为别名 — 拒绝，引入复杂度。

### Decision 5: UI 形态 — 二段式确认 + localadmin 行隐藏操作

**选择**:
- 每行根据 `u.role` 显示不同按钮文案：
  - `role === 'user'` → 「提升为管理员」，确认后 PATCH role='admin'
  - `role === 'admin'` → 「降级为用户」，确认后 PATCH role='user'
- 复用现有 `confirmId`/`resetId` 的二段式确认模式：点击后变为 `[确认] [取消]`。
- 当 `u.id === 'localadmin'` 时：
  - 隐藏「切换角色」「删除」按钮
  - 角色列右侧追加 🔒 锁标识（仅展示，不可点击）
  - 锁标识 hover 时显示 title="系统保护账户，不可降级或删除"

**理由**:
- 二段式确认与现有按钮一致，零学习成本。
- 锁标识明确告诉管理员「这行特殊」，避免误以为按钮缺失是 bug。

**备选**:
- 用 toast 提示错误而不隐藏按钮 — 拒绝，错误反馈不如直接禁用直观。
- 用 Switch 控件直接切换 — 拒绝，与现有按钮风格冲突。

### Decision 6: 「最后 admin」检查用 COUNT 查询

**选择**: 在 PATCH 路由内联查询：
```sql
SELECT COUNT(*) as cnt FROM users WHERE role='admin'
```
若 `cnt === 1` 且目标 role='user' 则拒绝。

**理由**:
- 简单直接，SQLite 单行 COUNT 极快。
- 不需要新建 lib 函数（一次性使用）。

**备选**:
- 提取 `countAdmins()` 函数 — 拒绝，YAGNI；当前无其他调用点。

## Risks / Trade-offs

- **[风险] 现有部署的 `admin` 用户继续工作但不享受 localadmin 保护**
  → 缓解：在 README 或运维文档说明（本变更不写文档，留待后续）；管理員可手动 CREATE 一个 localadmin 用户作为「概念对齐」。

- **[风险] 测试套件批量替换字面量易漏改导致回归**
  → 缓解：抽 `BOOTSTRAP_USER_ID` 常量后，TS 编译器会立即报错未引用的旧字面量；本轮实施会全量回归 `pnpm --filter server test`，确保零失败。

- **[风险] 并发降级导致 0 个 admin**
  → 缓解：PATCH 路由的「最后 admin」检查与 UPDATE 之间没有事务隔离；理论上两个 admin 同时降级最后两个 admin 可绕过。当前 sql.js 单线程串行执行，且实际场景几乎不会发生；可接受。

- **[风险] 用户已登录的 JWT 中 role 与实际 DB role 不一致**
  → 缓解：adminAuth 中间件每次查 DB，不信任 JWT；普通前端读取 `/api/me` 时可能拿到 stale role，但仅用于展示，不影响安全。可接受。

- **[权衡] UI 上 localadmin 行的按钮直接隐藏可能让管理员困惑「为什么这行没操作」**
  → 缓解：加锁图标 + tooltip 解释。

- **[权衡] 不做迁移意味着两种部署形态（admin vs localadmin）并存**
  → 缓解：用户已明确接受。文档/测试需要同时考虑两种场景。

## Migration Plan

- **部署前**: 在新部署的实例上首次启动时，bootstrap 创建 `localadmin` 而非 `admin`。
- **回滚**: 若新部署回滚到旧版本，`localadmin` 用户仍存在于数据库中，旧代码会按 `users.role='admin'` 正确识别其为 admin；唯一影响是旧代码的 bootstrap 不再创建 `admin`，但 `localadmin` 已有 admin 权限，不影响功能。
- **现有部署**: 无需操作，继续使用 `admin` 账户。如果管理员想用 `localadmin`，需要手动操作（删除 admin、手动改 bootstrap 代码或迁移数据），本变更不提供自动化工具。

## Open Questions

无。所有关键决策已与用户确认（迁移策略、保护范围、密码策略）。
