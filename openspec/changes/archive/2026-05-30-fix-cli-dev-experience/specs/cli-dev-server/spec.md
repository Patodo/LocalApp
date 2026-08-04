## MODIFIED Requirements

### Requirement: dev 命令

`localapp dev` 命令 SHALL 启动本地开发环境。命令 SHALL 读取项目根目录的 `manifest.json` 获取配置。命令 SHALL 写入 `.localapp/dev-config.json` 注入页面上下文。命令 SHALL 以子进程方式运行 `npm run dev`。命令 SHALL 输出本地访问 URL。

#### Scenario: 启动开发服务器
- **WHEN** 用户在项目根目录执行 `localapp dev`
- **THEN** CLI 读取 `manifest.json` 获取项目名和配置
- **THEN** CLI 写入 `.localapp/dev-config.json` 包含 `serverUrl`、`userId`、`pageName`
- **THEN** CLI 启动 `npm run dev` 子进程
- **THEN** 终端输出本地 URL（如 `http://localhost:5173`）

#### Scenario: API 代理模式（默认启用）
- **WHEN** 用户执行 `localapp dev`
- **THEN** Vite 开发服务器根据 dev-config.json 将 `/api/*` 请求改写为 `/serve/{userId}/{pageName}/api/*` 并代理到远程服务器
- **THEN** `/serve/*` 请求原样转发到远程服务器
- **THEN** 其他请求由本地 dev server 处理

## REMOVED Requirements

### Requirement: dev --proxy 标志
**Reason**: 代理功能已整合为 dev 命令的默认行为，不再需要单独的 `--proxy` 标志。路径改写取代了手工代理提示。
**Migration**: `--proxy` 标志从 CLI 参数中移除，代理功能默认启用。如需禁用代理，从 dev-config.json 中删除 `serverUrl`。
