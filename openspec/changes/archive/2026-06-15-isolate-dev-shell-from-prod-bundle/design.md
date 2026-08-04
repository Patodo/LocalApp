## Context

DevShell 的架构定位历史上经过两次变迁：

1. **初始版本（commit `0e0cc66`）**：DevShell 位于 `init-repo/src/dev-shell.tsx`，`main.tsx` 用 `import.meta.env.DEV` 条件渲染。dev 时包壳，生产时 tree-shake 掉。
2. **重组版本（commit `a0f72c3`）**：DevShell 迁到 `init-repo/runtime/dev-shell.tsx`，导入路径变为 `@localapp/app-kit/dev-shell`。**重组过程中条件渲染丢失**，所有环境都包 DevShell。

第二个版本是当前状态，导致：
- 生产构建里 DevShell 进了 dist/
- 上传后 server 端 PlatformShell 用 iframe 加载 dist，出现 nav-shell (外) + dev-shell (内) 的双壳
- dev 模式下 vite proxy 不传 credentials，`/api/me` 401，DevShell 工具瘫痪

本次变更的目标是建立"vite-plugin 注入"架构：DevShell 永远不进入用户源代码，由 vite-plugin 在 dev 模式虚拟注入，生产构建天然不含。

## Goals / Non-Goals

**Goals:**

- DevShell 完全不进入生产构建（dist/index.html 和 assets/*.js 不含 DevShell 相关代码）
- DevShell 通过 vite-plugin 在 dev 模式自动启用，用户 main.tsx 不引用 DevShell
- dev 模式下 `/api/*`、`/serve/*` 请求带上 API key，DevShell 的工具栏实际可用
- 存量项目通过 `localapp sync` 自动迁移到新架构
- DevShell 视觉与 nav-shell 在"底部彩条"这一点上对齐，作为视觉锚点

**Non-Goals:**

- DevShell 完整复刻 nav-shell 的品牌、登录、收藏、通知功能（那些是平台身份层，不属于调试工具）
- DevShell 重做样式系统
- 解决 `import.meta.env.DEV` 在 vite-plugin 中检测的边角情况（用 `command === 'serve'` 已足够）
- 处理用户已 eject 项目（eject 是高级用法，自负其责）
- 支持用户自定义 App 路径（严格假设 `src/App.tsx`）

## Decisions

### 决策 1：vite-plugin 虚拟模块注入（而非条件渲染或双入口）

**选择**：在 `vite-plugin.mjs` 中实现 `transformIndexHtml` + `resolveId`/`load` 钩子，dev 模式把 `<script src="/src/main.tsx">` 替换为 `<script src="/virtual:localapp-dev">`，虚拟模块内容是：

```js
import { DevShell } from "@localapp/app-kit/dev-shell";
import App from "/src/App.tsx";
import React from "react";
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DevShell><App /></DevShell>
  </React.StrictMode>
);
```

**理由**：

- **vs. 恢复 `import.meta.env.DEV` 条件**：恢复条件最简单，但 main.tsx 仍然引用 DevShell——用户领地不纯净。任何对 main.tsx 的 inspect 都会看到 DevShell 引用，造成"用户代码包含 CLI 工具"的混淆。
- **vs. 双入口（dev-main.tsx + main.tsx）**：双入口需要改 vite.config 和 npm scripts，配置复杂度高，且 dev 入口文件本身需要在用户领地（同样不纯净）。
- **vite-plugin 注入**：用户 main.tsx 永远只有 `render(<App />)`，DevShell 的存在对用户透明，符合"用户领地纯净"的架构原则。

**实现要点**：
- `transformIndexHtml` 钩子在 `apply: 'pre'` 阶段执行，正则替换 `<script type="module" crossorigin src="/src/main.tsx"></script>`
- 仅在 `command === 'serve'` 时激活；`command === 'build'` 时插件返回 null，index.html 原样输出
- 虚拟模块 ID 为 `\0virtual:localapp-dev`（vite 约定，前缀 `\0` 防止与其他模块冲突）
- **command 检测策略**：vite 6+ 不直接给 plugin 钩子传 `command`，因此 `config` 钩子把 command 写入 userConfig 的 `__localappCommand` 哨兵字段，`transformIndexHtml`/`buildStart` 通过 `this.environment.config.__localappCommand` 读取。测试场景下通过 `options.command` 显式注入，避开 vite environment API

### 决策 2：API key 落盘到 dev-config.json

**选择**：`localapp dev` 命令把当前配置的 API key 写入 `.localapp/dev-config.json` 的 `apiKey` 字段。vite-plugin 读取该字段，在 proxy 配置里给所有转发请求注入 `X-API-Key` header。

**理由**：

- dev-config.json 已在 init-repo `.gitignore` 中（与 serverUrl/userId/pageName 同级），落盘 api_key 不引入新泄露面
- vite-proxy 通过 `configure` 钩子在 proxyReq 上注入 header，不污染用户 fetch 代码
- 浏览器 fetch 仍然 `credentials: 'include'`，但实际鉴权依赖 X-API-Key（cookie 在 dev.localhost:5173 → server.localhost:3000 跨域时不可靠）

**未选方案**：
- 让用户手动设置环境变量 → 用户体验差
- vite-plugin 调用 `/api/me` 推断 → 推断不出 api_key 本身

### 决策 3：严格假设 `src/App.tsx`

**选择**：虚拟模块硬编码 `import App from "/src/App.tsx"`。

**理由**：

- 模板约定即合约。用户改路径属于"自行脱离模板支持"
- 文档/skills 中明确说明，避免误用
- 与 `manifest.json` 的 `name` 字段、`tsconfig.base.json` 的 paths 配置形成一致的"模板契约"集合

**未选方案**：
- 在 `manifest.json` 加 `appEntry` 字段 → 增加 manifest 复杂度，价值低
- vite-plugin 探测 main.tsx 头部 import → 实现魔法，调试困难

### 决策 4：sync 自动 patch main.tsx（严格匹配）

**选择**：`localapp sync` 执行时，检查用户项目根的 `src/main.tsx`：

- 如果内容**严格等于**旧模板（commit `a0f72c3` 之后、本次变更之前的版本），自动改写为新模板（只 render App）
- 如果内容与旧模板不完全相等（用户已自定义），仅打印警告"main.tsx 包含 DevShell 引用，请手动调整为 render(<App />)"，不自动改写

**理由**：

- 自动 patch 给存量项目（sample-app 等）提供零摩擦迁移路径
- 严格匹配避免破坏用户自定义代码
- 用户自定义时打印警告，让他们知情决策

**实现要点**：
- 匹配的"旧模板"用字符串字面量内嵌在 sync 命令中（或 template.rs），便于精确比对
- 字符串相同则替换；否则 grep 检查 DevShell 关键字决定是否打印警告

### 决策 5：DevShell 视觉轻度美化

**选择**：在 DevShell 的 nav 底部加一条彩色渐变条（`bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-orange-400`），与 nav-shell 的 Navbar 底部彩条对齐。其他元素（DEV 徽章、AI 按钮、tools 列表）保持不变。

**理由**：

- 彩条是 nav-shell 最显眼的视觉锚点，dev-shell 加上后视觉上"是同一系产品"
- 不复刻 nav-shell 的头像/登录/收藏——那些功能在 dev 模式没意义（dev 时身份来自 api_key，不是用户登录态）
- 工作量极小（一行 JSX），不偏离本次变更的核心 scope

## Risks / Trade-offs

- **[Risk] 用户改了 App 路径** → vite-plugin 找不到 App，dev 模式白屏。**缓解**：CLAUDE.md 和 skills 文档明确"App 必须在 src/App.tsx"；vite-plugin 在 dev 模式启动时检查文件存在性，缺失时打印明确错误。
- **[Risk] vite-plugin.mjs 是纯 JS，无法直接 import .tsx** → 虚拟模块引用 `@localapp/app-kit/dev-shell` 时，vite 自动用 esbuild 处理 tsx 编译。**缓解**：vite-plugin.mjs 只需要返回字符串形式的虚拟模块代码，编译交给 vite；现有 vite-plugin 已经能处理用户的 tsx 代码，路径一致。
- **[Risk] api_key 落盘到 dev-config.json** → 文件已在 .gitignore，但本地明文存储仍有泄露风险（如恶意软件读取）。**缓解**：dev-config.json 已是 dev-only 文件（生产构建不依赖），且 server 端的 api_key 本就是高权限凭据；用户可手动配置短期 key 降低风险。
- **[Risk] sync 自动 patch 误判** → 严格字符串匹配可能漏掉用户做的细微修改（如换行符差异）。**缓解**：匹配前做 normalize（统一换行符、trim），匹配失败时降级为警告模式。
- **[Trade-off] 用户感知 DevShell 的方式改变** → 以前用户能在 main.tsx 看到 DevShell 引用，现在变成"魔法"。**缓解**：DevShell 在 dev 模式有明显的 DEV 徽章，用户始终能看到它在工作；CLAUDE.md 解释清楚。

## Migration Plan

1. **CLI 升级**：用户运行 `localapp update` 拿到新版 CLI
2. **sync 自动迁移**：用户在项目目录运行 `localapp sync`（或 `npm install` 触发 postinstall sync）
   - sync 检测 main.tsx 是旧模板，自动改写
   - sync 刷新 runtime/ 到新版本（含新的 vite-plugin.mjs、dev-shell.tsx）
3. **重新 dev**：用户运行 `localapp dev`
   - dev 命令写入新字段 `apiKey` 到 dev-config.json
   - vite 启动时 vite-plugin 激活虚拟模块，DevShell 在 dev 模式正常工作
4. **upload 验证**：用户运行 `localapp upload`
   - dist/ 不含 DevShell 代码
   - 上传后访问，nav-shell 单壳加载 App

**回滚策略**：本变更主要是模板代码改动，回滚等于 revert 这个变更的 commit。存量项目已 sync 到新模板，回滚 CLI 后再次 sync 会恢复旧模板（含 main.tsx 旧版本）。

## Open Questions

无。所有关键决策已在探索阶段与用户确认（4 个澄清问题已回答）。
