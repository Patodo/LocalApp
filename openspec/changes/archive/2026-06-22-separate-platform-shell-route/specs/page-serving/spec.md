## ADDED Requirements

### Requirement: 正式入口和裸资源入口职责分离

服务端 SHALL 明确区分正式应用入口与裸应用资源入口。`GET /{userId}/{name}` 和 `GET /{userId}/{name}/` SHALL 返回带 PlatformShell 的正式应用页面；`GET /serve/{userId}/{name}/` 和 `GET /serve/{userId}/{name}/*` SHALL 只返回上传应用的裸 `index.html`、assets、SPA fallback 或应用 API 响应。

#### Scenario: 正式入口返回 PlatformShell
- **WHEN** 已存在应用 `example-user/sample-app`，用户请求 `GET /example-user/sample-app/`
- **THEN** 响应 SHALL 为 HTML
- **AND** 响应 SHALL 包含 PlatformShell 的 native shell 标识或 mount container
- **AND** 响应 SHALL 使用 `/serve/example-user/sample-app/` 作为 native app resource base

#### Scenario: 裸资源入口不返回 nav-shell
- **WHEN** 已存在应用 `example-user/sample-app`，用户请求 `GET /serve/example-user/sample-app/`
- **THEN** 响应 SHALL 为上传应用最新版本的 `index.html`
- **AND** 响应 SHALL NOT 包含 PlatformShell 导航栏
- **AND** 响应 SHALL NOT 包含 native shell 标识

#### Scenario: /serve 无尾路径仍只规范化裸资源入口
- **WHEN** 用户请求 `GET /serve/example-user/sample-app`
- **THEN** 服务端 MAY 重定向到 `/serve/example-user/sample-app/`
- **AND** 重定向目标 SHALL 仍为裸资源入口
- **AND** SHALL NOT 跳转到 PlatformShell 模板路由

### Requirement: server shell 模板读取使用独立导出路径

服务端在处理正式入口时 SHALL 从独立 PlatformShell 静态导出路径读取 shell 模板，不得从 `/serve` 静态导出路径读取 shell 模板。

#### Scenario: shell 模板缺失时返回明确错误
- **WHEN** `web/out/platform-shell/placeholder/placeholder.html` 不存在
- **AND** 用户请求 `GET /example-user/sample-app/`
- **THEN** 服务端 SHALL 返回 404 或明确错误
- **AND** 错误信息 SHALL 指向 shell 未构建或需要构建 web

#### Scenario: 模板参数注入正确
- **WHEN** 用户请求 `GET /example-user/sample-app/`
- **THEN** 服务端 SHALL 将 placeholder 参数替换为 `example-user` 和 `sample-app`
- **AND** 返回 HTML 中的 native app resource base SHALL 为 `/serve/example-user/sample-app/`
