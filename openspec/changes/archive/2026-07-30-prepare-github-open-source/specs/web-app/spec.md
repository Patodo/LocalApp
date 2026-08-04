## MODIFIED Requirements

### Requirement: 登录页面

`/login` 路径 SHALL 渲染登录页面。页面 SHALL 包含用户名/邮箱输入框、密码输入框和登录按钮。表单提交 SHALL 调用 `POST /api/auth/login`。登录成功 SHALL 跳转到 `redirect` 查询参数指定的地址或 `/profile`。

#### Scenario: 登录成功
- **WHEN** 用户填写正确的用户名和密码并提交
- **THEN** 调用 `POST /api/auth/login` 成功
- **THEN** 页面跳转到 `redirect` 参数指定的地址

#### Scenario: 登录失败
- **WHEN** 用户填写错误的密码
- **THEN** 页面显示错误信息，不跳转
- **THEN** 表单保留用户已输入的用户名

#### Scenario: 已登录用户访问
- **WHEN** 已登录用户访问 `/login`
- **THEN** 自动跳转到 `/profile`

### Requirement: Fastify 静态托管

Fastify 服务器 SHALL 托管 Next.js 的静态导出产物。`/login`、`/force-change-password`、`/` 路由 SHALL 指向 Next.js 页面而非 serve.ts 的模板函数。Spa 风格的客户端路由 SHALL 通过 fallback 到 `index.html` 支持。

#### Scenario: 访问登录页面
- **WHEN** 浏览器请求 `/login`
- **THEN** 返回 `packages/web/out/login.html` 的内容

#### Scenario: API 路由不受影响
- **WHEN** 浏览器请求 `POST /api/auth/login`
- **THEN** 请求由 Fastify 路由处理，不被静态文件拦截

## REMOVED Requirements

### Requirement: 注册页面

**Reason**: 公开注册与管理员供应的账户安全边界冲突。

**Migration**: 管理员在用户管理页供应账号；用户使用一次性凭据完成首次登录和强制改密。
