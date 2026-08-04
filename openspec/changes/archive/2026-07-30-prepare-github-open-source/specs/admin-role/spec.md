## MODIFIED Requirements

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
