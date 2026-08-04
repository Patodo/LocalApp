## MODIFIED Requirements

### Requirement: 正式入口和裸资源入口职责分离

服务端 SHALL 明确区分正式应用入口与裸应用资源入口。`GET /{userId}/{name}` 和 `GET /{userId}/{name}/` SHALL 返回带 PlatformShell 的正式应用页面，并作为用户访问、应用验收和 UI 级验证的默认入口。`GET /serve/{userId}/{name}/` 和 `GET /serve/{userId}/{name}/*` SHALL 只返回上传应用的裸 `index.html`、assets、SPA fallback 或应用 API 响应；该路径 SHALL 被视为内部 raw app resource/API route，不得在用户文档、CLI 默认输出或 agent 验收步骤中称为预览入口。

#### Scenario: 正式入口返回 PlatformShell
- **WHEN** 已存在应用 `example-user/sample-app`，用户请求 `GET /example-user/sample-app/`
- **THEN** 响应 SHALL 为 HTML
- **AND** 响应 SHALL 包含 PlatformShell 的 native shell 标识或 mount container
- **AND** 响应 SHALL 使用 `/serve/example-user/sample-app/` 作为 native app resource base

#### Scenario: 用户验收访问正式入口
- **WHEN** agent 或测试人员需要验证 `example-user/sample-app` 的用户可见功能
- **THEN** 验证入口 SHALL 为 `/example-user/sample-app/`
- **AND** 测试 SHALL 覆盖平台 nav-shell 与 native app container 的组合运行形态
- **AND** SHALL NOT 使用 `/serve/example-user/sample-app/` 作为默认验收入口

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

## ADDED Requirements

### Requirement: raw route 仅用于资源和应用 API 验证

测试或文档直接访问 `/serve/{userId}/{name}/` 时，目标 SHALL 限定为 raw resource、SPA fallback、静态资源安全头、MIME、或 `/serve/{userId}/{name}/api/*` 应用级 API 契约，不得用于判断平台 Shell、导航栏、Issue、AI 侧栏、登录入口或收藏等用户体验功能。

#### Scenario: raw route 测试资源服务
- **WHEN** 测试请求 `GET /serve/example-user/sample-app/assets/app.js`
- **THEN** 测试 SHALL 断言静态资源服务行为
- **AND** 测试 SHALL NOT 断言平台 nav-shell 行为

#### Scenario: shell 能力测试不访问 raw route
- **WHEN** 测试需要验证 Issue 入口、AI 侧栏或用户头像
- **THEN** 测试 SHALL 访问 `/example-user/sample-app/`
- **AND** 测试 SHALL NOT 访问 `/serve/example-user/sample-app/`
