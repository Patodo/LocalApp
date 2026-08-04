## MODIFIED Requirements

### Requirement: 页面 iframe 包装

`GET /{userId}/{name}` SHALL 返回平台壳 HTML 页面，包含导航栏（显示登录状态）和内嵌 sandbox iframe 指向 `/serve/{userId}/{name}/`。平台壳 MUST 从 session cookie 提取访客身份用于渲染登录状态。

#### Scenario: 访问已存在的页面（已登录）
- **WHEN** 请求 `GET /user1/my-cool-app` 携带有效 JWT cookie 且该页面存在
- **THEN** 返回平台壳 HTML，导航栏显示用户名，iframe 指向 `/serve/user1/my-cool-app/`

#### Scenario: 访问已存在的页面（未登录）
- **WHEN** 请求 `GET /user1/my-cool-app` 不携带 cookie 且该页面存在
- **THEN** 返回平台壳 HTML，导航栏显示登录按钮，iframe 指向 `/serve/user1/my-cool-app/`

#### Scenario: 访问不存在的页面
- **WHEN** 请求 `GET /user1/nonexistent`
- **THEN** 返回 HTTP 404，`{ success: false, error: "Page not found" }`

#### Scenario: 页面配置为 authenticated 但未登录
- **WHEN** 请求 `GET /user1/private-app` 且页面的 `pageAccess.level` 为 `"authenticated"` 且未登录
- **THEN** 返回 HTTP 401

#### Scenario: 页面配置为 private 且非所有者
- **WHEN** 请求 `GET /user1/private-app` 且页面的 `pageAccess.level` 为 `"owner"` 且 visitorId 不等于 page.userId
- **THEN** 返回 HTTP 403
