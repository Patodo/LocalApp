## ADDED Requirements

### Requirement: 根路径重定向

`GET /` SHALL 根据用户登录状态执行重定向。已登录用户（session cookie 有效）SHALL 重定向到 `/profile`。未登录用户 SHALL 重定向到 `/login?redirect=/`。

#### Scenario: 已登录用户访问根路径
- **WHEN** 携带有效 session cookie 请求 `GET /`
- **THEN** 返回 HTTP 302，Location 为 `/profile`

#### Scenario: 未登录用户访问根路径
- **WHEN** 不携带 session cookie 请求 `GET /`
- **THEN** 返回 HTTP 302，Location 为 `/login?redirect=/`

#### Scenario: 登录后通过 fallback 回到根路径
- **WHEN** 用户在 `/login` 页面登录成功，无 redirect 参数，JS fallback 到 `/`
- **THEN** `/` 重定向到 `/profile`，用户最终看到个人主页
