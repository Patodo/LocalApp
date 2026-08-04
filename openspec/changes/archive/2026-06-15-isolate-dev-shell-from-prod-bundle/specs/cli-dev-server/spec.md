## MODIFIED Requirements

### Requirement: dev 命令

`localapp dev` 命令 SHALL 启动本地开发环境。命令 SHALL 读取项目根目录的 `manifest.json` 获取配置。命令 SHALL 写入 `.localapp/dev-config.json` 注入页面上下文，包括 `serverUrl`、`userId`、`pageName`、`apiKey` 四个字段。命令 SHALL 以子进程方式运行 `npm run dev`。命令 SHALL 输出本地访问 URL。

`apiKey` 字段 SHALL 从 CLI 当前配置（`config.json` 的 `api_key`）读取。若用户未登录（无 api_key），SHALL 写入空字符串并打印警告，dev 模式下 DevShell 的工具栏将无法访问需要鉴权的 API。

#### Scenario: 启动开发服务器
- **WHEN** 用户在项目根目录执行 `localapp dev`
- **THEN** CLI 读取 `manifest.json` 获取项目名和配置
- **THEN** CLI 写入 `.localapp/dev-config.json` 包含 `serverUrl`、`userId`、`pageName`、`apiKey` 四个字段
- **THEN** CLI 启动 `npm run dev` 子进程
- **THEN** 终端输出本地 URL（如 `http://localhost:5173`）

#### Scenario: 已登录用户写入 apiKey
- **WHEN** 用户已通过 `localapp login` 配置 API Key，执行 `localapp dev`
- **THEN** CLI 从 `config.json` 读取 `api_key` 字段
- **THEN** 写入 `.localapp/dev-config.json` 的 `apiKey` 字段等于该 API Key
- **AND** 终端不打印鉴权相关警告

#### Scenario: 未登录用户写入空 apiKey
- **WHEN** 用户未配置 API Key，执行 `localapp dev`
- **THEN** CLI 写入 `.localapp/dev-config.json` 的 `apiKey` 字段为空字符串
- **AND** 终端打印警告 "Warning: not logged in, apiKey is empty. DevShell tools requiring auth will fail."

#### Scenario: API 代理模式（默认启用）
- **WHEN** 用户执行 `localapp dev`
- **THEN** Vite 开发服务器根据 dev-config.json 将 `/api/*` 请求改写为 `/serve/{userId}/{pageName}/api/*` 并代理到远程服务器
- **AND** 所有转发的请求 SHALL 携带 `X-API-Key` header（值来自 dev-config.json 的 `apiKey` 字段）
- **THEN** `/serve/*` 请求原样转发到远程服务器（同样携带 X-API-Key header）
- **THEN** 其他请求由本地 dev server 处理
