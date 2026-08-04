## ADDED Requirements

### Requirement: CLI dev 命令写入 dev-config.json

`localapp dev` 命令 SHALL 在启动本地开发服务器前，向项目根目录的 `.localapp/dev-config.json` 写入页面上下文信息。文件 SHALL 包含 `serverUrl`、`userId`、`pageName` 三个字段。

#### Scenario: 写入完整 dev 配置
- **WHEN** 用户在项目根目录执行 `localapp dev`
- **THEN** CLI 从 `manifest.json` 读取 `name` 字段作为 `pageName`
- **THEN** CLI 从当前配置推断 `userId`（已登录用户 or OS 用户名）
- **THEN** CLI 写入 `.localapp/dev-config.json`，内容为 `{ "serverUrl": "...", "userId": "...", "pageName": "..." }`
- **THEN** 终端提示 "Dev config written to .localapp/dev-config.json"

#### Scenario: userId 推断优先级
- **WHEN** 用户已通过 `localapp login` 配置 API Key
- **THEN** CLI 使用 `config.json` 中关联的用户名作为 `userId`
- **WHEN** 用户未登录
- **THEN** CLI 使用当前操作系统用户名作为默认 `userId`

### Requirement: Vite 代理路径改写

Vite 开发服务器配置 SHALL 读取 `.localapp/dev-config.json`，当文件中包含 `userId` 和 `pageName` 时，SHALL 将 `/api/*` 请求路径改写为 `/serve/{userId}/{pageName}/api/*` 后再转发到 `serverUrl`。

#### Scenario: API 请求路径改写
- **WHEN** `dev-config.json` 包含 `{ "userId": "demo", "pageName": "bugreport" }`
- **AND** 浏览器发起 `GET /api/bugs?offset=0&limit=20`
- **THEN** Vite 代理将请求路径改写为 `GET /serve/demo/bugreport/api/bugs?offset=0&limit=20`
- **THEN** 请求转发到 `serverUrl` 配置的服务器

#### Scenario: 缺少上下文时原样转发
- **WHEN** `dev-config.json` 不包含 `userId` 或 `pageName` 字段
- **THEN** Vite 代理将 `/api/*` 请求原样转发到 `serverUrl`
- **THEN** 行为与之前版本保持一致（向后兼容）

#### Scenario: /serve 路径直接转发
- **WHEN** 浏览器发起 `/serve/*` 请求（如图片、静态文件）
- **THEN** Vite 代理将请求原样转发，不做路径改写
