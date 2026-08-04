## Why

用户使用 `localapp init` 时必须先安装 Node.js，但当前 CLI 只报错退出，不提供任何帮助。这在新用户首次体验时造成阻碍。CLI 应该能自动检测并引导用户完成 Node.js 安装。

## What Changes

- CLI 检测到 Node.js 缺失时，尝试从 server 下载 Node.js 安装包（仅 Windows，固定 Node.js 22 LTS）
- 下载完成后弹出 Windows 安装向导，由用户手动完成安装
- Server 未托管 Node.js 安装包时（404），降级为提示用户自行访问 nodejs.org 安装
- Server 新增 `/api/deps/node` 公开路由，托管 Node.js 安装包（可选能力）
- Server 新增 `static/deps/` 目录存放 Node.js 安装包

## Capabilities

### New Capabilities

- `nodejs-deps`: Server 托管和分发 Node.js 安装包的能力

### Modified Capabilities

（无已有规格需要修改）

## Impact

- `packages/cli/src/pm.rs`：`check_available()` 从单纯报错改为尝试自动安装
- `packages/server/src/routes/`：新增 deps 路由
- `packages/server/static/deps/`：新增 Node.js 安装包存储目录
