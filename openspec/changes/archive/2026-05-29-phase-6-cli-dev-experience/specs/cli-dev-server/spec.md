## ADDED Requirements

### Requirement: dev 命令

`localapp dev` 命令 SHALL 启动本地开发环境。命令 SHALL 读取项目根目录的 `manifest.json` 获取配置。命令 SHALL 以子进程方式运行 `npm run dev`。命令 SHALL 输出本地访问 URL。

#### Scenario: 启动开发服务器
- **WHEN** 用户在项目根目录执行 `localapp dev`
- **THEN** CLI 读取 `manifest.json` 获取项目名和配置
- **THEN** CLI 启动 `npm run dev` 子进程
- **THEN** 终端输出本地 URL（如 `http://localhost:5173`）

#### Scenario: API 代理模式
- **WHEN** 用户执行 `localapp dev --proxy`
- **THEN** CLI 启动本地 HTTP 代理服务
- **THEN** `/api/*` 和 `/serve/*` 请求转发到配置的远程服务器
- **THEN** 其他请求转发到本地 dev server

### Requirement: generate 命令

`localapp generate` 命令 SHALL 支持以下子命令：

- `generate schema <name>` — 生成 schema 定义 JSON 文件
- `generate page <name>` — 生成新页面 `.tsx` 文件
- `generate component <name>` — 生成 React 组件骨架

所有生成的文件 SHALL 包含基础结构，不包含业务逻辑。

#### Scenario: 生成 schema 定义
- **WHEN** 用户执行 `localapp generate schema todos`
- **THEN** 在项目目录生成 `schemas/todos.json`
- **THEN** 文件包含预填的字段结构模板

#### Scenario: 生成新页面
- **WHEN** 用户执行 `localapp generate page about`
- **THEN** 在项目目录生成 `src/pages/About.tsx`
- **THEN** 文件包含基础 React 组件骨架和 export

#### Scenario: 生成组件
- **WHEN** 用户执行 `localapp generate component Button`
- **THEN** 在项目目录生成 `src/components/Button.tsx`
- **THEN** 文件包含基础 TypeScript React 组件骨架

### Requirement: whoami 命令

`localapp whoami` 命令 SHALL 向配置的服务器发送 `GET /api/me` 请求，并显示当前用户信息（用户名、用户 ID、服务器 URL）。

#### Scenario: 显示当前用户
- **WHEN** 用户已登录且执行 `localapp whoami`
- **THEN** 显示: 用户名、用户 ID、服务器 URL

#### Scenario: 未登录
- **WHEN** 用户未配置 API Key 或会话过期
- **THEN** 显示 "Not logged in" 并提示执行 `localapp login`

### Requirement: logout 命令

`localapp logout` 命令 SHALL 清除本地配置中的 API Key。命令 SHALL 不清除 server URL。

#### Scenario: 登出
- **WHEN** 用户执行 `localapp logout`
- **THEN** 本地 `config.json` 中 `api_key` 字段被移除
- **THEN** 终端显示 "Logged out successfully"

### Requirement: init 使用 npm 模板

`localapp init --name <name>` 命令 SHALL 默认使用 npm 模板（`@localapp/template`）。`--builtin-repo` 标志 SHALL 保留用于离线场景。

#### Scenario: 从 npm 模板初始化
- **WHEN** 用户执行 `localapp init --name my-app`
- **THEN** CLI 使用 `npm create @localapp/template` 或等效方式拉取最新模板
- **THEN** 项目创建完成，包含 `package.json` 和基础文件

### Requirement: upload 移除 SDK 复制

`localapp upload` 命令 SHALL 不再复制 SDK 源码文件到用户项目。SDK 管理 SHALL 完全由 npm 依赖处理。

#### Scenario: 上传时不复制 SDK
- **WHEN** 用户执行 `localapp upload`（无路径参数）
- **THEN** CLI 运行 `npm run build`
- **THEN** CLI 上传 `dist/` 目录
- **THEN** CLI 不复制任何 SDK 源文件
