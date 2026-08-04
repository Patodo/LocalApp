## Why

当前 LocalApp 页面访问（`GET /:userId/:name`）始终渲染平台 Shell（导航栏 + iframe 嵌套）。对于纯工具页面、嵌入式组件、或需要全屏展示的应用，固定导航栏是多余的，而且 iframe 嵌套在某些场景下会带来限制（如全屏 API、键盘事件捕获等）。用户需要在 manifest.json 中声明是否显示导航栏，让平台根据配置决定渲染方式。

## What Changes

- `manifest.json` 新增 `shell` 字段，支持 `{ "navbar": false }` 配置
- 服务端 `serve.ts` 读取页面的 shell 配置，`navbar: false` 时直接 serve 页面内容（无 iframe 包裹）
- CLI upload 命令读取 manifest.json 的 `shell` 配置并上传到服务端
- 服务端 upload 路由接收并持久化 shell 配置到 `meta.json`

## Capabilities

### New Capabilities

（无新增能力规格）

### Modified Capabilities

- `manifest-config`: manifest.json 新增 `shell.navbar` 可选字段
- `page-serving`: 服务端根据 shell 配置决定渲染方式（Shell 模式 vs 直接服务模式）
- `file-upload`: upload 接口接收并持久化 shell 配置

## Impact

- `packages/server/src/routes/serve.ts` 增加条件渲染逻辑
- `packages/server/src/routes/upload.ts` 接收 shell 配置
- `packages/cli/src/commands/upload.rs` 读取并传递 shell 配置
- `packages/server/src/types/models.ts` Page 相关类型增加 shell 字段
