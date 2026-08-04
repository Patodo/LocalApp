## Purpose

TBD — CLI 开发体验相关功能规格，涵盖本地开发服务器、代码生成、用户认证命令和构建上传流程。
## Requirements
### Requirement: dev 命令

`localapp dev` 命令 SHALL 启动本地开发环境,流程:

1. 校验 `manifest.json` 存在
2. 随机分配 mini-server 端口(5174-5200 范围)
3. spawn Node 子进程运行 `runtime/mini-server.mjs`,传入端口 + 数据目录 + 生产 server URL + API key
4. 等待 mini-server 监听成功(轮询 `/health` 端点)
5. 写入 `.localapp/dev-config.json`,包含 `serverUrl`、`userId`、`pageName`、`apiKey`、`miniServerPort` 五个字段
6. spawn Vite 开发脚本：优先 `npm run dev:vite`，旧项目无该脚本时回退 `npm run dev`
7. 等待 vite 进程退出,退出时同时终止 mini-server

dev 命令 SHALL 在 mini-server 启动失败时打印错误并退出。
dev 命令 SHALL 支持未登录本地开发；未配置 API key 时，CLI SHALL 写入空 `apiKey` 并启动本地 mini-server，本地应用 API 不得依赖平台连接。

#### Scenario: dev 启动 mini-server 和 vite
- **WHEN** 用户执行 `localapp dev`
- **THEN` CLI` 随机分配 mini-server 端口(5174-5200)
- **AND` CLI` spawn `node runtime/mini-server.mjs --port <N> ...`
- **AND` CLI` 轮询 mini-server `/health` 端点直到成功
- **AND` CLI` 写入 dev-config.json(含 miniServerPort 字段)
- **AND` CLI` spawn `npm run dev:vite`(vite)，旧项目无 `dev:vite` 时回退 `npm run dev`
- **AND` 终端打印两个进程的状态

#### Scenario: mini-server 启动失败时退出
- **WHEN` localapp dev` 启动 mini-server 子进程,5 秒内未监听端口
- **THEN` CLI` 打印错误 "Mini-server failed to start within 5 seconds"
- **AND` 退出码` 1
- **AND` vite` 不启动

#### Scenario: dev-config.json 包含 miniServerPort
- **WHEN` localapp dev` 成功启动后查看 dev-config.json
- **THEN` 文件包含 `"miniServerPort": <N>` 字段
- **AND` vite-plugin` 读取该字段配置 proxy target

#### Scenario: vite 退出时 mini-server 也终止
- **WHEN` vite` 进程退出(用户 Ctrl+C 或 kill)
- **THEN` CLI` 检测到 vite 退出
- **AND` CLI` 向 mini-server 发送 SIGTERM
- **AND` CLI` 等待 mini-server 退出(最长 3 秒)
- **AND` CLI` 退出

#### Scenario: 未登录也可启动本地开发
- **WHEN** 用户未运行 `localapp login` 且执行 `localapp dev`
- **THEN** CLI SHALL 使用 OS 用户名作为本地 userId fallback
- **AND** dev-config.json SHALL 包含空字符串 `apiKey`
- **AND** mini-server SHALL 提供本地 `/api/me`、`/api/users`、`/api/groups`、named SQL 和内容上传能力
- **AND** 除 `/api/llm/*` 等远端能力外，应用 SHALL NOT 需要连接平台即可开发

#### Scenario: dev 脚本递归保护识别带参数或 wrapper 的 localapp dev
- **WHEN** `package.json` 只有 `scripts.dev = "localapp dev --host 0.0.0.0"` 或 `"cross-env NODE_ENV=development localapp dev"`，且没有 `scripts.dev:vite`
- **THEN** `localapp dev` SHALL 拒绝启动并提示运行 `localapp sync` 修复

#### Scenario: runtime 依赖刷新后清理 Vite 预构建缓存
- **WHEN** `.localapp/runtime` 与已安装的 file dependency 内容不一致
- **THEN** `localapp dev` SHALL 先刷新依赖安装
- **AND** SHALL 删除 `node_modules/.vite` 中基于旧依赖生成的预构建缓存
- **AND** SHALL NOT 删除应用数据、业务源码或其他构建目录
- **AND** 随后 SHALL 通过 `dev:vite` 启动且浏览器不得因旧 CJS/ESM 导出缓存出现空白页

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

`localapp init --name <name>` 命令 SHALL 默认使用内置模板初始化项目。`--skip-install` 标志 SHALL 跳过 `npm install`。`--skip-deploy` 标志 SHALL 跳过部署步骤（注册、构建、上传），但不跳过依赖安装。`--builtin-repo` 标志 SHALL 保留用于离线场景。

#### Scenario: 从内置模板初始化
- **WHEN** 用户执行 `localapp init --name my-app`
- **THEN** CLI 使用内置模板创建项目
- **THEN** CLI 自动运行 `npm install` 安装依赖
- **THEN** 项目创建完成，包含 `package.json`、`node_modules` 和基础文件

#### Scenario: 跳过依赖安装
- **WHEN** 用户执行 `localapp init --name my-app --skip-install`
- **THEN** CLI 使用内置模板创建项目
- **THEN** CLI 不运行 `npm install`
- **THEN** 终端提示 "Skipping npm install. Run 'npm install' manually to install dependencies."

#### Scenario: 跳过部署
- **WHEN** 用户执行 `localapp init --name my-app --skip-deploy`
- **THEN** CLI 创建项目并安装依赖
- **THEN** CLI 跳过部署步骤（注册 page、构建、上传）
- **THEN** 终端提示部署步骤已跳过

### Requirement: upload 移除 SDK 复制

`localapp upload` 命令 SHALL 不再复制 SDK 源码文件到用户项目。SDK 管理 SHALL 完全由 npm 依赖处理。

#### Scenario: 上传时不复制 SDK
- **WHEN** 用户执行 `localapp upload`（无路径参数）
- **THEN** CLI 运行 `npm run build`
- **THEN** CLI 上传 `dist/` 目录
- **THEN** CLI 不复制任何 SDK 源文件

### Requirement: localapp db 子命令族

CLI SHALL 提供 `localapp db` 子命令族,管理应用层 SQL migrations 和 dev.db:

- `localapp db migrate` — 应用未应用 migrations 到 dev.db
- `localapp db status` — 显示已应用 / 未应用 migration 列表
- `localapp db reset` — 清空 dev.db,从头应用 migrations + seed
- `localapp db validate` — 拉 prod snapshot 验证 migrations
- `localapp db types -o <file>` — 反向生成 TypeScript 类型
- `localapp db shell` — 启动 sqlite3 CLI 连接 dev.db
- `localapp db restore --backup v1 --i-know-this-loses-data` — 紧急恢复(详见 upload-atomic-deploy spec)

`localapp db <subcommand> --help` SHALL 显示该子命令的用法。

#### Scenario: localapp db 命令存在
- **WHEN` 用户执行 `localapp db --help`
- **THEN` CLI` 列出所有 db 子命令及简短描述
- **AND` 提示用户 `localapp db <subcommand> --help` 查看详情

#### Scenario: db 命令在项目根目录外执行报错
- **WHEN` 用户在非 localapp 项目目录执行 `localapp db migrate`
- **THEN` CLI` 检测到无 manifest.json
- **AND` 打印错误 "Not a localapp project. Run localapp init first."
- **AND` 退出码` 1

### Requirement: localapp migrate-from-manifest 迁移命令

CLI SHALL 提供 `localapp migrate-from-manifest` 一次性命令,把现有项目的 manifest.schemas 转换为初始 SQL migration。流程:

1. 读 manifest.json 的 schemas 数组
2. 为每个 schema 生成 CREATE TABLE SQL
3. 写入 `migrations/001_initial_from_manifest.sql`
4. 备份 manifest.json 到 `manifest.json.bak`
5. 移除 manifest.json 的 schemas 字段(保留 business 字段如有)
6. 提示用户运行 `localapp db migrate` 应用到 dev.db

#### Scenario: 从 manifest.schemas 转换
- **WHEN` 用户在含 manifest.schemas 的项目执行 `localapp migrate-from-manifest`
- **THEN` CLI` 读 manifest.schemas
- **AND` 生成 `migrations/001_initial_from_manifest.sql` 含所有 CREATE TABLE
- **AND` 备份 manifest.json 到 manifest.json.bak
- **AND` manifest.json` 移除 schemas 字段
- **AND` 打印 "Migration complete. Run localapp db migrate to apply."

#### Scenario: 项目无 manifest.schemas 时跳过
- **WHEN` 用户执行 `localapp migrate-from-manifest`,但 manifest.json 无 schemas 字段
- **THEN` CLI` 打印 "manifest.json has no schemas array. Nothing to migrate."
- **AND` 退出码` 0

#### Scenario: migrations 目录已存在时提示
- **WHEN` 用户执行 `localapp migrate-from-manifest`,但项目已有 migrations/ 目录
- **THEN` CLI` 拒绝执行
- **AND` 打印 "migrations/ directory already exists. Migration may have been done. Remove the directory to retry."
- **AND` 退出码` 1

### Requirement: dev 命令写入 miniServerPort 字段

`localapp dev` 写入 dev-config.json 时 SHALL 包含 `miniServerPort` 字段,值为本进程分配的 mini-server 端口号。

#### Scenario: dev-config.json 含 miniServerPort
- **WHEN` 用户执行 `localapp dev`,mini-server 分配端口 5178
- **THEN` dev-config.json` 包含 `"miniServerPort": 5178`
- **AND` vite-plugin` 读取该字段配置 proxy target

#### Scenario: vite-plugin 读不到 miniServerPort 时降级
- **WHEN` vite-plugin` 启动时 dev-config.json 无 miniServerPort 字段
- **THEN` vite-plugin` 打印警告 "dev-config.json missing miniServerPort. Falling back to direct proxy to serverUrl."
- **AND` vite-plugin` 把所有 /api/* 转发到 serverUrl(旧行为)
- **AND` 应用可工作,但数据走生产(慎用)

### Requirement: localapp dev 启动 native dev runtime
`localapp dev` SHALL 启动 mini-server 和 Vite，并使浏览器页面运行 native DevShell + App。dev runtime SHALL 不依赖 iframe。

#### Scenario: dev 页面为 native shell
- **WHEN** 用户执行 `localapp dev`
- **THEN** Vite 页面 SHALL 渲染 DevShell 和 App 的同页结构
- **AND** 页面 SHALL NOT 使用 iframe 承载 App

### Requirement: dev config 写入 native runtime 所需信息
`localapp dev` SHALL 写入 dev-config，包括 userId、pageName、serverUrl、miniServerPort 和 native runtime 所需的 shell 上下文。

#### Scenario: dev-config 包含 mini-server 端口
- **WHEN** `localapp dev` 成功启动
- **THEN** `.localapp/dev-config.json` SHALL 包含 `miniServerPort`
- **AND** Vite plugin SHALL 使用该端口分流 `/api/*`

#### Scenario: serverUrl 为空但 miniServerPort 存在时仍走本地 API
- **WHEN** `.localapp/dev-config.json` 包含 `miniServerPort` 但 `serverUrl` 为空
- **THEN** Vite plugin SHALL 将 `/api/*` 代理到本地 mini-server
- **AND** `/api/llm/*` SHALL NOT 配置远端代理
- **AND** `/api/users`、`/api/dev/users` 等本地开发请求 SHALL NOT 落到 Vite HTML fallback
