## ADDED Requirements

### Requirement: 无尾斜杠的 /serve 路径重定向

`GET /serve/:userId/:name`（无尾部斜杠）SHALL 返回 HTTP 301 永久重定向到 `GET /serve/:userId/:name/`（带尾部斜杠）。此重定向确保浏览器以正确的基准路径解析 HTML 中的相对资源引用（如 `./assets/app.js`）。

重定向 MUST 保留查询参数（如有）。

#### Scenario: 无尾斜杠请求重定向
- **WHEN** 请求 `GET /serve/user1/my-app`（无尾斜杠）
- **THEN** 返回 HTTP 301，Location 为 `/serve/user1/my-app/`

#### Scenario: 无尾斜杠请求带查询参数
- **WHEN** 请求 `GET /serve/user1/my-app?foo=bar`（无尾斜杠且有查询参数）
- **THEN** 返回 HTTP 301，Location 为 `/serve/user1/my-app/?foo=bar`

#### Scenario: 带尾斜杠请求不受影响
- **WHEN** 请求 `GET /serve/user1/my-app/`（已有尾斜杠）
- **THEN** 正常返回 `index.html` 内容，不触发重定向

#### Scenario: 已登录且页面为 authenticated 时不影响重定向
- **WHEN** 请求 `GET /serve/user1/private-app`（无尾斜杠），页面为 authenticated 级别且未登录
- **THEN** 重定向到带尾斜杠路径后，由带尾斜杠路由执行访问控制检查后返回相应错误
