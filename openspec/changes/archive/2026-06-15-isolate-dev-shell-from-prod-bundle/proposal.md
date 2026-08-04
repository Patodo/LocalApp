## Why

DevShell 当前在生产构建里也被渲染。根因是 commit `a0f72c3`（重组源码分离用户/CLI 领地）把 dev-shell.tsx 从 `src/` 迁到 `runtime/` 时，丢失了 `import.meta.env.DEV` 条件渲染——原本只在 dev 模式包 DevShell，现在所有环境都包。导致两个症状：

1. **双壳泄漏**：用户上传后，dist/index.html 里 DevShell 包着 App，server 端 PlatformShell 又用 iframe 加载 dist，出现"nav-shell (iframe 外) + dev-shell (iframe 内)"的双壳。DevShell 的工具栏（DEV 徽章、AI 按钮）作为应用内容泄露到线上。
2. **dev 工具瘫痪**：dev 模式下 vite proxy 不传 credentials，`/api/me` 返回 401，DevShell 的 system tools（getCurrentUser/queryData）全部失效。

这次同时解决"架构隔离"和"dev 鉴权"两个根因，让 DevShell 真正成为"本地调试时的 nav-shell 等价物"——存在于 vite-plugin 注入的虚拟层，永远不进入用户代码和生产 bundle。

## What Changes

- **vite-plugin 注入 DevShell（核心）**：`init-repo/runtime/vite-plugin.mjs` 新增 `transformIndexHtml` 钩子。dev 模式下把 `<script src="/src/main.tsx">` 替换为 `<script src="/virtual:localapp-dev">`；虚拟模块由插件 `resolveId`/`load` 提供，内容是 `render(<DevShell><App/></DevShell>)`。生产 `vite build` 时插件 no-op，index.html 原样保留，DevShell 完全不在依赖图里。
- **main.tsx 简化**：模板的 `src/main.tsx` 永远只 `render(<App />)`，不引用 DevShell。
- **App 路径严格假设**：vite-plugin 假设用户 App 在 `/src/App.tsx`（模板约定）；用户改路径则需自行负责，文档说明清楚。
- **dev 鉴权注入**：`dev-config.json` 新增 `apiKey` 字段（CLI 写入当前登录用户的 API key），vite-plugin 在 proxy 配置里给所有 `/api/*`、`/serve/*` 请求注入 `X-API-Key` header。
- **sync 自动 patch 存量项目**：`localapp sync` 检测到旧模式 `import { DevShell } from "@localapp/app-kit/dev-shell"` + `<DevShell><App /></DevShell>` 时，自动改写为只 render App；用户已自定义的 main.tsx 不动，仅打印警告。
- **DevShell 轻度美化**：保留朴素调试工具栏定位，加底部彩色渐变条对齐 nav-shell 视觉锚点；不做 nav-shell 完整复刻（无登录/收藏/通知，那些是平台身份层职责）。

## Capabilities

### New Capabilities

- `dev-shell-injection`: 通过 vite-plugin 的虚拟模块机制在 dev 模式注入 DevShell，生产构建完全隔离的架构契约

### Modified Capabilities

- `cli-dev-server`: dev 命令写入 `apiKey` 到 dev-config.json
- `dev-config-context`: dev-config.json 新增 `apiKey` 字段；vite-proxy 在转发请求时注入 `X-API-Key` header
- `runtime-zone-sync`: sync 命令检测并自动改写旧版 main.tsx（移除 DevShell 引用），仅匹配严格模板模式
- `init-template`: 模板的 `src/main.tsx` 简化为只 render App；vite-plugin 新增虚拟模块注入逻辑；DevShell 加视觉锚点彩条

## Impact

**代码改动**：
- `init-repo/runtime/vite-plugin.mjs`（核心注入逻辑 + proxy 鉴权）
- `init-repo/runtime/dev-shell.tsx`（轻度美化）
- `init-repo/src/main.tsx`（简化）
- `packages/cli/src/commands/dev.rs`（写入 apiKey）
- `packages/cli/src/commands/sync.rs` 或 `packages/cli/src/template.rs`（main.tsx 自动 patch）

**测试影响**：
- 现有 e2e 测试如果有断言"dist 包含 DevShell 字符串"，需调整为"dist 不包含 DevShell"
- 新增 e2e：dev 模式注入 DevShell、生产构建不含 DevShell、sync 自动 patch、proxy 注入 X-API-Key

**用户项目迁移**：
- 存量项目（sample-app 等）执行 `localapp sync` 后，main.tsx 自动改写，DevShell 不再出现在 dist
- 用户已自定义 main.tsx 的项目需要手动调整（sync 仅警告不改写）

**文档**：
- `init-repo/CLAUDE.md` 说明 main.tsx 现在纯净，DevShell 由 vite-plugin 在 dev 时自动注入，用户无需也无法手动启用

**非破坏性**：所有改动向后兼容（生产构建产物变化是修复 bug，不算 breaking）。
