## Why

CLI 目前没有更新机制。Server 升级后 API 可能不兼容，旧 CLI 连新 Server 会静默失败或产生无意义错误，用户没有清晰的恢复路径。需要建立强制更新通道：Server 声明最低兼容版本，CLI 携带版本号，版本不匹配时阻断并引导用户更新。

## What Changes

- CLI 编译时嵌入版本号（来自 Cargo.toml），所有 HTTP 请求附带 `X-CLI-Version` header
- Server auth hook 校验 `X-CLI-Version`，低于 `MIN_CLI_VERSION` 或无 header 返回 403 并提示更新
- CLI 新增 `update` 命令：从 Server 下载最新二进制并自替换
- Server 新增两个 API：`GET /api/cli/version`（版本信息）和 `GET /api/cli/download`（下载二进制）
- Server `static/cli/` 目录存放各平台二进制产物和 `versions.json`
- **BREAKING**: 旧 CLI（不发送 `X-CLI-Version` header）连接新 Server 将被拒绝

## Capabilities

### New Capabilities

- `cli-update`: CLI 版本检查与自动更新机制，包括 Server 端版本校验、下载端点，以及 CLI 端 update 命令和自替换逻辑

### Modified Capabilities

- `cli-tool`: 新增 `update` 子命令；Client 所有请求增加 `X-CLI-Version` header
- `api-key-auth`: auth hook 增加版本校验逻辑，低于 min 版本或无 header 返回 403

## Impact

- CLI: `main.rs`（新增 Update 命令）、`client.rs`（所有方法加 header）、新增 `commands/update.rs`
- Server: `index.ts`（注册 update 路由）、`plugins/auth.ts`（版本校验 hook）、新增 `routes/cli.ts`
- Shared: 新增 `CliVersionResponse`、`CliDownloadQuery` 类型
- 运维: 新增环境变量 `MIN_CLI_VERSION`，新增 `static/cli/` 目录存放二进制制品
