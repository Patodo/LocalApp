## ADDED Requirements

### Requirement: 统一 dashboard 路由处理器

服务端 SHALL 提供 `/my` 和 `/my/*` 通配路由，注册在 `/:userId/:name` 之前，统一处理所有 dashboard 页面的静态 HTML 服务。

#### Scenario: 已登录用户访问 /my/apps
- **WHEN** 已登录用户请求 `GET /my/apps`
- **THEN** 返回 `packages/web/out/my/apps.html` 的内容（200，Content-Type: text/html）

#### Scenario: 已登录用户访问 /my/info
- **WHEN** 已登录用户请求 `GET /my/info`
- **THEN** 返回 `packages/web/out/my/info.html` 的内容（200，Content-Type: text/html）

#### Scenario: 已登录用户访问 /my/keys
- **WHEN** 已登录用户请求 `GET /my/keys`
- **THEN** 返回 `packages/web/out/my/keys.html` 的内容（200，Content-Type: text/html）

#### Scenario: 已登录用户访问 /my/groups
- **WHEN** 已登录用户请求 `GET /my/groups`
- **THEN** 返回 `packages/web/out/my/groups.html` 的内容（200，Content-Type: text/html）

#### Scenario: 未登录用户访问 /my/apps
- **WHEN** 未登录用户请求 `GET /my/apps`
- **THEN** 返回 302 重定向到 `/login?redirect=/my/apps`

### Requirement: Admin dashboard 页面角色检查

`/my/dashboard`、`/my/analytics`、`/my/users`、`/my/pages`、`/my/orgs`、`/my/settings` 页面 SHALL 要求 admin 角色。

#### Scenario: Admin 用户访问 /my/dashboard
- **WHEN** 已登录的 admin 用户请求 `GET /my/dashboard`
- **THEN** 返回 dashboard 页面 HTML（200）

#### Scenario: 普通用户访问 /my/dashboard
- **WHEN** 已登录的普通用户（role=user）请求 `GET /my/dashboard`
- **THEN** 返回 302 重定向到 `/`

#### Scenario: 未登录用户访问 /my/dashboard
- **WHEN** 未登录用户请求 `GET /my/dashboard`
- **THEN** 返回 302 重定向到 `/login?redirect=/my/dashboard`

### Requirement: /my 路径重定向

`GET /my` SHALL 重定向到 `/my/info`。

#### Scenario: 访问 /my 根路径
- **WHEN** 已登录用户请求 `GET /my`
- **THEN** 返回 302 重定向到 `/my/info`

### Requirement: 页面不存在时 HTML 404

当请求的 `/my/*` 路径没有对应的静态 HTML 文件时，SHALL 返回 HTML 格式的 404 页面，风格与登录页面一致（浅色主题）。

#### Scenario: 访问不存在的 dashboard 页面
- **WHEN** 已登录用户请求 `GET /my/nonexistent`
- **THEN** 返回 404 状态码和 HTML 内容（Content-Type: text/html）

#### Scenario: 用户页面 404 返回 HTML
- **WHEN** 用户请求 `GET /nonuser/nonapp` 且 readPageMeta 返回 null
- **THEN** 返回 404 状态码和 HTML 内容（非 JSON）
