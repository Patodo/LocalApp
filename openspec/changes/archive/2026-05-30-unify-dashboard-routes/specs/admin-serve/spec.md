## MODIFIED Requirements

### Requirement: 管理面板服务端路由
服务端 SHALL 通过 `/my/*` 路由提供管理面板页面。Admin 页面（dashboard、analytics、users、pages、orgs、settings）SHALL 要求 admin 角色。

#### Scenario: admin 用户访问 /my/dashboard
- **WHEN** 已登录的 admin 用户访问 `GET /my/dashboard`
- **THEN** 返回管理面板 HTML（200）
- **AND** HTML 加载管理面板 SPA 的 JS/CSS 资源

#### Scenario: 非登录用户访问 /my/dashboard
- **WHEN** 未登录用户访问 `GET /my/dashboard`
- **THEN** 返回 302 重定向到 `/login?redirect=/my/dashboard`

#### Scenario: 非 admin 用户访问 /my/dashboard
- **WHEN** 已登录的普通用户（role=user）访问 `GET /my/dashboard`
- **THEN** 返回 302 重定向到 `/`

#### Scenario: admin 用户访问其他管理页面
- **WHEN** 已登录的 admin 用户访问 `GET /my/analytics`、`GET /my/users`、`GET /my/pages`、`GET /my/orgs`、`GET /my/settings`
- **THEN** 返回对应的管理面板 HTML（200）

## REMOVED Requirements

### Requirement: /admin 路由
**Reason**: 所有 dashboard 路由统一到 `/my/*`，admin 是有额外权限的用户而非独立体系
**Migration**: `/admin/*` → `/my/*`，对应关系见 design.md 映射表
