## Why

当前 CLI 的工具链对于"写完代码 → 构建 → 上传 → 在浏览器确认"的循环体验不够流畅。用户必须在每次修改后手动执行 `npm run build && localapp upload`，然后刷新浏览器。缺少现代化 CLI 工具标配的本地开发服务器和脚手架生成能力。在 [LocalApp 总体方案](../../../docs/plan.md) Phase 1 将 SDK 变为独立 npm 包后，Phase 6 新增 `dev` 和 `generate` 命令，参考 Vercel CLI 的 `vercel dev` 模式改善开发体验。

## What Changes

### 新增 CLI 命令

- **`localapp dev`** — 启动本地开发服务器
  - 在项目目录中执行 `npm run dev`（即 Vite dev server）
  - 自动注入 `LocalAppProvider` 的 `basePath` 指向本地或远程 API
  - 可选：代理 `/api/*` 请求到远程服务器（`localapp dev --proxy`）
  - 浏览器自动打开

- **`localapp generate`** — 脚手架生成器
  - `localapp generate schema <name>` — 在当前目录生成 schema 定义 JSON 文件
  - `localapp generate page <name>` — 生成新的页面文件（`.tsx` + 路由注册）
  - 可选：`localapp generate component <name>` — 生成 React 组件骨架

- **`localapp whoami`** — 显示当前登录用户信息（server URL + user name/id）
- **`localapp logout`** — 清除本地存储的 API Key 和配置

### 修改已有命令

- **`localapp init`** — 改用 `@localapp/template` npm 包替代编译时嵌入模板。支持 `--template` 选择模板变体
- **`localapp upload`** — 移除 SDK 源码复制逻辑（Phase 1 已完成 SDK 包化，CLI 侧做对应清理）

## Capabilities

### New Capabilities

- `cli-dev-server`: 本地开发服务器，支持热重载和 API 代理
- `cli-generate`: 脚手架生成命令
- `cli-identity`: 用户身份管理命令（whoami、logout）

### Modified Capabilities

- `cli-init`: init 命令改用 npm 模板
- `cli-upload`: upload 命令移除 SDK 源码复制

## Impact

- 修改: `packages/cli/src/main.rs`（新增命令注册）
- 新增: `packages/cli/src/commands/dev.rs`
- 新增: `packages/cli/src/commands/generate.rs`
- 新增: `packages/cli/src/commands/whoami.rs`
- 修改: `packages/cli/src/commands/init.rs`（改用 npm 模板）
- 修改: `packages/cli/src/commands/upload.rs`（移除 SDK 复制）
- 修改: `packages/cli/src/config.rs`（新增 logout 方法）
- 不影响: 服务器端代码
