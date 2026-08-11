## Purpose

定义统一 Server 开发模式的 `.localapp/dev-config.json` 和 Vite 代理契约。

## Requirements

### Requirement: dev 配置只描述一个 Server

`localapp dev` SHALL 写入 `serverUrl`、`userId`、`pageName`、`apiKey` 和 `appServerPort`。`serverUrl` SHALL 严格等于本次启动项目 Server 的 `http://127.0.0.1:<nonzero-port>`，不得包含 userinfo、额外路径、query 或 fragment；配置 SHALL NOT 包含第二个 HTTP 服务地址或端口。

#### Scenario: 写入完整配置

- **WHEN** `skill-market` 开发 Server 在 `http://127.0.0.1:43123` 就绪且 Vite 使用 5173
- **THEN** `.localapp/dev-config.json` SHALL 包含 `serverUrl=http://127.0.0.1:43123`
- **AND** SHALL 包含 `userId=dev-user`、`pageName=skill-market`、Server API Key 和 `appServerPort=5173`
- **AND** 配置对象 SHALL 只有这五个字段

### Requirement: Vite 代理统一注入认证和应用上下文

Vite SHALL 把应用作用域 API 改写到 `/serve/<userId>/<pageName>/api/*`，把全局 API 原样转发，并在所有转发请求上注入 `X-API-Key`。所有 `/api/dev/*` SHALL 原样转发到同一 `serverUrl`，同时注入 `X-LocalApp-Dev-Page`。

#### Scenario: 应用 API 改写

- **WHEN** 浏览器请求 `/api/queries/$records.list?limit=20`
- **THEN** Vite SHALL 转发到 `<serverUrl>/serve/dev-user/<pageName>/api/queries/$records.list?limit=20`
- **AND** SHALL 注入 API Key

#### Scenario: 全局 API 原样转发

- **WHEN** 浏览器请求 `/api/me`、`/api/users`、`/api/groups`、`/api/issues` 或 `/api/llm/*`
- **THEN** Vite SHALL 保持请求路径
- **AND** SHALL 转发到同一 `serverUrl`
- **AND** SHALL 注入 API Key

#### Scenario: 全局 API 使用路径边界

- **WHEN** 浏览器请求 `/api/messages`
- **THEN** `/api/me` 例外 SHALL NOT 匹配该请求
- **AND** Vite SHALL 按应用 API 将其改写到 `<serverUrl>/serve/dev-user/<pageName>/api/messages`

#### Scenario: Dev Toolkit API 原样转发

- **WHEN** DevShell 请求 `/api/dev/context`
- **THEN** Vite SHALL 保持请求路径并转发到同一 `serverUrl`
- **AND** SHALL 注入 API Key 和 `X-LocalApp-Dev-Page: <pageName>`

#### Scenario: 缺少统一 Server 配置

- **WHEN** `serverUrl`、`userId`、`pageName` 或 `apiKey` 缺失
- **THEN** Vite SHALL 输出明确配置错误
- **AND** SHALL NOT 静默回退到远程 Server 或无认证代理

#### Scenario: Server URL 不是严格回环监听地址

- **WHEN** `serverUrl` 不是精确的 `http://127.0.0.1:<nonzero-port>`
- **THEN** Vite SHALL 在创建 credential-injecting proxy 前拒绝配置
- **AND** SHALL NOT 向该地址发送 API Key
