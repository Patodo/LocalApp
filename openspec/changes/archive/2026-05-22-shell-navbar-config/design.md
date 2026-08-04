## Context

当前页面访问 `GET /:userId/:name` 始终渲染平台 Shell（导航栏 + iframe 嵌套）。iframe 内加载 `/serve/{userId}/{name}/` 的页面内容。某些场景（纯工具页面、嵌入式组件、全屏应用）不需要导航栏。

现有渲染流程：
```
GET /:userId/:name
  → 检查 pageAccess → 渲染 Shell HTML（nav bar + iframe → /serve/{userId}/{name}/）
```

相关文件：
- `packages/server/src/routes/serve.ts`：Shell 渲染和静态文件服务
- `packages/server/src/routes/upload.ts`：上传时写入 meta.json
- `packages/server/src/types/models.ts`：Page 类型定义
- `packages/cli/src/commands/upload.rs`：CLI 读取 manifest.json 并上传
- `packages/cli/src/project.rs`：manifest.json 类型定义

## Goals / Non-Goals

**Goals:**
- manifest.json 支持声明 `shell.navbar` 配置
- `navbar: false` 时直接服务页面内容，无 Shell 包裹
- 上传时自动同步 shell 配置到服务端

**Non-Goals:**
- 不支持自定义导航栏样式/内容（只做隐藏/显示）
- 不改变 iframe 内页面的任何行为
- 不新增 SDK Hook（这是纯服务端+配置变更）

## Decisions

### 1. navbar: false 时使用 HTTP 302 重定向

当 `navbar: false` 时，`GET /:userId/:name` 返回 302 重定向到 `/serve/{userId}/{name}/`。这样直接复用现有的静态文件服务逻辑，无需新增渲染路径。

备选方案：直接在 `/:userId/:name` 路由内 serve 静态文件（内联 serve 逻辑）。但这样会与 `/serve/` 路由的静态文件服务逻辑重复，增加维护成本。

选择重定向方案更简洁。

### 2. shell 配置存储在 meta.json

与现有 `dbConfig` 的存储方式一致，upload 时写入 `meta.json` 的 `shell` 字段。serve 路由从 meta.json 读取配置。

### 3. manifest.json 中 shell 为可选字段

不设置时默认 `navbar: true`（保持现有行为）。只有明确设置 `shell.navbar: false` 才会改变渲染。

## Risks / Trade-offs

- [重定向增加一次 HTTP 往返] → 302 重定向对用户体验影响可忽略（单次额外请求），换来的是代码简洁
- [已有页面升级后 manifest.json 无 shell 字段] → 默认行为不变（navbar: true），向后兼容
