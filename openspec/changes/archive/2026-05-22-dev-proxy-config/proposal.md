## Why

当前 `localapp init` 生成的项目在本地 `npm run dev` 时无法使用 SDK（CRUD、身份查询），因为 Vite dev server 运行在 `localhost:5173`，无法访问 LocalApp 服务器。用户只能在部署后才能看到效果，开发反馈循环太慢。

## What Changes

- 修改 `init-repo/vite.config.ts`：添加 proxy 配置，将 `/api` 和 `/serve` 转发到 LocalApp 服务器，服务器地址从 `.localapp/dev-config.json` 读取
- 修改 `packages/cli/src/commands/init.rs`：init 完成后写入 `.localapp/dev-config.json`，包含服务器地址（从 CLI 配置读取）
- 添加 `init-repo/.gitignore`：忽略 `.localapp/dev-config.json`（本地开发配置，不应提交到版本控制）

## Capabilities

### New Capabilities

（无新增 capability）

### Modified Capabilities
- `cli-tool`：init 命令增加写入 `.localapp/dev-config.json` 步骤
- `init-template`：vite.config.ts 添加 proxy 配置，新增 .gitignore

## Impact

- 修改 `init-repo/vite.config.ts`（添加 proxy + 读取 dev config）
- 新增 `init-repo/.gitignore`
- 修改 `packages/cli/src/commands/init.rs`（写 dev-config.json）
- 修改 `packages/client/src/` 源码无需改动
