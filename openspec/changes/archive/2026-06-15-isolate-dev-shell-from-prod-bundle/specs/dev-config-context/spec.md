## MODIFIED Requirements

### Requirement: CLI dev 命令写入 dev-config.json

`localapp dev` 命令 SHALL 在启动本地开发服务器前，向项目根目录的 `.localapp/dev-config.json` 写入页面上下文信息。文件 SHALL 包含 `serverUrl`、`userId`、`pageName`、`apiKey` 四个字段。

#### Scenario: 写入完整 dev 配置
- **WHEN** 用户在项目根目录执行 `localapp dev`
- **THEN** CLI 从 `manifest.json` 读取 `name` 字段作为 `pageName`
- **THEN** CLI 调用 `/api/me` 用当前 API Key 推断 `userId`，失败时降级为 OS 用户名并打印警告
- **THEN** CLI 从 `config.json` 读取 `api_key` 作为 `apiKey` 字段（未登录则为空字符串）
- **THEN** CLI 写入 `.localapp/dev-config.json`，内容为 `{ "serverUrl": "...", "userId": "...", "pageName": "...", "apiKey": "..." }`
- **THEN** 终端提示 "Dev config written to .localapp/dev-config.json"

#### Scenario: userId 推断优先级
- **WHEN** 用户已通过 `localapp login` 配置 API Key
- **THEN** CLI 使用 API Key 调用 `/api/me`，用返回的 user.id 作为 `userId`
- **WHEN** 用户未登录或 `/api/me` 失败
- **THEN** CLI 使用当前操作系统用户名作为默认 `userId`，打印警告

#### Scenario: apiKey 字段处理
- **WHEN** 用户已登录
- **THEN** `apiKey` 字段等于 `config.json` 中的 `api_key`
- **WHEN** 用户未登录
- **THEN** `apiKey` 字段为空字符串
- **AND** 终端打印警告说明 DevShell 的鉴权工具将失效

### Requirement: Vite 代理路径改写与鉴权注入

Vite 开发服务器配置 SHALL 读取 `.localapp/dev-config.json`，当文件中包含 `userId` 和 `pageName` 时，SHALL 将 `/api/*` 请求路径改写为 `/serve/{userId}/{pageName}/api/*` 后再转发到 `serverUrl`。

当 `apiKey` 字段非空时，Vite 代理 SHALL 在所有转发的请求（`/api/*`、`/serve/*`、`/api/me`、`/api/users`、`/api/groups`、`/api/llm` 等）注入 `X-API-Key` header，值为 `apiKey` 字段内容。

#### Scenario: API 请求路径改写并注入鉴权
- **WHEN** `dev-config.json` 包含 `{ "userId": "demo", "pageName": "bugreport", "apiKey": "key_xxx" }`
- **AND** 浏览器发起 `GET /api/bugs?offset=0&limit=20`
- **THEN** Vite 代理将请求路径改写为 `GET /serve/demo/bugreport/api/bugs?offset=0&limit=20`
- **AND** 请求转发到 `serverUrl`，附带 `X-API-Key: key_xxx` header

#### Scenario: 全局端点注入鉴权
- **WHEN** `dev-config.json` 包含非空 `apiKey`
- **AND** 浏览器发起 `/api/me`、`/api/users`、`/api/groups`、`/api/llm` 请求
- **THEN** Vite 代理原样转发到 `serverUrl`（路径不改写）
- **AND** 请求附带 `X-API-Key` header

#### Scenario: 缺少 apiKey 时不注入鉴权
- **WHEN** `dev-config.json` 的 `apiKey` 字段为空字符串或不存在
- **THEN** Vite 代理不注入 `X-API-Key` header
- **AND** 请求仍按路径改写规则转发（路径行为不依赖 apiKey）

#### Scenario: 缺少 userId/pageName 时原样转发
- **WHEN** `dev-config.json` 不包含 `userId` 或 `pageName` 字段
- **THEN** Vite 代理将 `/api/*` 请求原样转发到 `serverUrl`
- **THEN** 行为与之前版本保持一致（向后兼容）

#### Scenario: /serve 路径直接转发
- **WHEN** 浏览器发起 `/serve/*` 请求（如图片、静态文件）
- **THEN** Vite 代理将请求原样转发，不做路径改写
- **AND** 当 apiKey 非空时附带 `X-API-Key` header
