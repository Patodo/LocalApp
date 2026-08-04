## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the admin-role capability in LocalApp.

## Requirements

### Requirement: 管理员角色模型
系统 SHALL 在 `users` 表支持 `role` 字段，取值为 `'admin'` 或 `'user'`，默认 `'user'`。

#### Scenario: 新供应用户默认为 user 角色
- **WHEN** 管理员通过用户供应接口创建用户
- **THEN** 创建的用户 `role` 为 `'user'`

#### Scenario: bootstrap 用户自动标记为 admin
- **WHEN** 服务器启动时 `BOOTSTRAP_API_KEY` 环境变量存在
- **THEN** 系统创建 `id='localadmin'` 的内置管理员账户（若不存在），`role` 设为 `'admin'`，关联 bootstrap API key
- **AND** 若 `localadmin` 已存在，仅确保其 `role='admin'`，不修改其他字段

#### Scenario: admin 角色校验
- **WHEN** 请求访问 `/api/admin/*` 路由
- **THEN** 中间件从认证信息（JWT cookie 或 API key）获取用户 ID，查询 `users.role`，仅 `role='admin'` 放行
- **AND** 非 admin 返回 403

#### Scenario: JWT payload 包含角色信息
- **WHEN** 用户登录成功
- **THEN** JWT payload 新增 `role` 字段，`/api/me` 返回 `role`

### Requirement: 系统保护账户 localadmin

系统 SHALL 维护一个固定的受保护用户 ID 列表，当前包含 `localadmin`。该账户在新部署中由 bootstrap 自动创建并永久持有 admin 角色，禁止通过任何管理界面或 API 修改其角色、删除其账户或重命名其 ID。

#### Scenario: localadmin 永久保持 admin 角色
- **WHEN** 系统初始化（bootstrap）创建 `localadmin` 用户
- **THEN** 该用户 `role='admin'`，无法被任何 API（含 `PATCH /api/admin/users/localadmin/role`）改为 `'user'`

#### Scenario: 系统保护账户 ID 列表收敛在单一常量
- **WHEN** 检查 `meta-sqlite.ts` 源码
- **THEN** 存在 `PROTECTED_USER_IDS` 常量（数组形式）与 `isProtectedUserId(id)` 守卫函数
- **AND** 所有需要判断「该用户是否受保护」的代码路径（DELETE/PATCH 路由及未来的 rename 路由）均通过该函数判断，禁止在调用点硬编码 `id === 'localadmin'`

#### Scenario: 旧部署中的 admin 账户不受本规则保护
- **WHEN** 现有部署（在本变更生效前已初始化）启动
- **THEN** 该部署仍保留 `id='admin'` 账户，按既有行为运行
- **AND** 不自动迁移、不创建 `localadmin`
- **AND** `admin` 账户不享受 localadmin 的保护（可被降级或删除）
