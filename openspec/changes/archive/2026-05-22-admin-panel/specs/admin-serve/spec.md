## NEW Requirements

### Requirement: 管理面板服务端路由
服务端 SHALL 提供 `/admin` 路由直接服务管理面板。

#### Scenario: admin 用户访问 /admin
- **WHEN** 已登录的 admin 用户访问 `GET /admin`
- **THEN** 返回管理面板 HTML（200）
- **AND** HTML 加载管理面板 SPA 的 JS/CSS 资源

#### Scenario: 非登录用户访问 /admin
- **WHEN** 未登录用户访问 `GET /admin`
- **THEN** 返回 302 重定向到 `/login?redirect=/admin`

#### Scenario: 非 admin 用户访问 /admin
- **WHEN** 已登录的普通用户（role=user）访问 `GET /admin`
- **THEN** 返回 403 或重定向到首页

#### Scenario: 管理面板静态资源
- **WHEN** 请求 `GET /admin/assets/*`
- **THEN** 返回对应的 JS/CSS 静态文件
