## MODIFIED Requirements

### Requirement: dev 命令

`localapp dev` 命令 SHALL 启动本地开发环境,流程:

1. 校验 `manifest.json` 存在
2. 随机分配 mini-server 端口(5174-5200 范围)
3. spawn Node 子进程运行 `runtime/mini-server.mjs`,传入端口 + 数据目录 + 生产 server URL + API key
4. 等待 mini-server 监听成功(轮询 `/health` 端点)
5. 写入 `.localapp/dev-config.json`,包含 `serverUrl`、`userId`、`pageName`、`apiKey`、`miniServerPort` 五个字段
6. spawn `npm run dev`(vite)
7. 等待 vite 进程退出,退出时同时终止 mini-server

dev 命令 SHALL 在 mini-server 启动失败时打印错误并退出。

#### Scenario: dev 启动 mini-server 和 vite
- **WHEN** 用户执行 `localapp dev`
- **THEN` CLI` 随机分配 mini-server 端口(5174-5200)
- **AND` CLI` spawn `node runtime/mini-server.mjs --port <N> ...`
- **AND` CLI` 轮询 mini-server `/health` 端点直到成功
- **AND` CLI` 写入 dev-config.json(含 miniServerPort 字段)
- **AND` CLI` spawn `npm run dev`(vite)
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

## ADDED Requirements

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
