## NEW Requirements

### Requirement: 管理员角色模型
系统 SHALL 在 `users` 表支持 `role` 字段，取值为 `'admin'` 或 `'user'`，默认 `'user'`。

#### Scenario: 新用户注册默认为 user 角色
- **WHEN** 用户通过 `POST /api/auth/register` 注册
- **THEN** 创建的用户 `role` 为 `'user'`

#### Scenario: bootstrap 用户自动标记为 admin
- **WHEN** 服务器启动时 `BOOTSTRAP_API_KEY` 环境变量存在
- **THEN** `user_id='admin'` 对应的用户（若存在于 users 表）`role` 被设为 `'admin'`

#### Scenario: admin 角色校验
- **WHEN** 请求访问 `/api/admin/*` 路由
- **THEN** 中间件从认证信息（JWT cookie 或 API key）获取用户 ID，查询 `users.role`，仅 `role='admin'` 放行
- **AND** 非 admin 返回 403

#### Scenario: JWT payload 包含角色信息
- **WHEN** 用户登录成功
- **THEN** JWT payload 新增 `role` 字段，`/api/me` 返回 `role`
