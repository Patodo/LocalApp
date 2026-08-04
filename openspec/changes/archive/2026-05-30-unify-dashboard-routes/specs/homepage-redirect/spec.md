## MODIFIED Requirements

### Requirement: 根路径重定向

`GET /` SHALL 返回首页 HTML（200），不再执行重定向。首页展示已登录用户的 workspace 概览。

#### Scenario: 已登录用户访问根路径
- **WHEN** 携带有效 session cookie 请求 `GET /`
- **THEN** 返回首页 HTML（200），展示 My Apps、Favorites、Recent 模块

#### Scenario: 未登录用户访问根路径
- **WHEN** 不携带 session cookie 请求 `GET /`
- **THEN** 返回首页 HTML（200），客户端 JS 检测未登录后重定向到 `/login?redirect=/`

### Requirement: 404 页面 HTML 渲染

当请求的页面路径不存在时，服务端 SHALL 返回 HTML 格式的 404 页面，而非 JSON。

#### Scenario: 用户应用页面不存在
- **WHEN** 请求 `GET /nonuser/nonapp` 且 readPageMeta 返回 null
- **THEN** 返回 404 状态码和 HTML 内容，页面提示"页面不存在"

#### Scenario: dashboard 子页面不存在
- **WHEN** 已登录用户请求 `GET /my/nonexistent`
- **THEN** 返回 404 状态码和 HTML 内容
