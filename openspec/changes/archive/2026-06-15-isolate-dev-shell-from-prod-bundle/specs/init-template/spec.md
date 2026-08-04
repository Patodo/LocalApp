## MODIFIED Requirements

### Requirement: 用户项目 src/main.tsx 极简化

模板的 `src/main.tsx` SHALL 极简化为约 4 行：导入 React、ReactDOM、App，渲染 `<App />`。原有的 `import "./index.css"` 保留。**main.tsx SHALL NOT 引用 DevShell**——DevShell 由 vite-plugin 在 dev 模式虚拟注入（详见 dev-shell-injection capability）。

#### Scenario: main.tsx 极简不引用 DevShell
- **WHEN** 查看 `init-repo/src/main.tsx`
- **THEN** 文件约 4-5 行：`import React from "react"`、`import ReactDOM from "react-dom/client"`、`import App from "./App.js"`、`import "./index.css"`，调用 `ReactDOM.createRoot(...).render(<App />)`
- **AND** 文件**不**包含 `import { DevShell }` 或 `<DevShell>` 标签

#### Scenario: dev 模式下 DevShell 由 vite-plugin 注入
- **WHEN** 在 dev 环境（`vite dev` / `npm run dev`）运行
- **THEN** vite-plugin 的 `transformIndexHtml` 钩子将 `<script src="/src/main.tsx">` 替换为虚拟模块
- **AND** 虚拟模块导入 DevShell 和 App，渲染 `<DevShell><App /></DevShell>`

#### Scenario: 生产构建剥离 DevShell
- **WHEN** 执行 `npm run build`
- **THEN** vite-plugin 不激活注入逻辑，main.tsx 直接渲染 `<App />`
- **AND** 生成的 `dist/` 不含 DevShell 相关代码（tree-shaking + 入口替换双重保证）

## ADDED Requirements

### Requirement: vite-plugin.mjs 实现 DevShell 虚拟模块注入

`init-repo/runtime/vite-plugin.mjs` SHALL 实现三个 vite 钩子完成 DevShell 的 dev 模式注入：

1. **`transformIndexHtml`**（`apply: 'pre'`）：仅在 `command === 'serve'` 时激活，将 `<script type="module" crossorigin src="/src/main.tsx"></script>` 替换为 `<script type="module" src="/virtual:localapp-dev"></script>`
2. **`resolveId`**：识别 `\0virtual:localapp-dev` 虚拟模块 ID 并返回解析结果
3. **`load`**：对 `\0virtual:localapp-dev` 返回虚拟模块代码字符串，内容为：
   ```js
   import React from "react";
   import { createRoot } from "react-dom/client";
   import { DevShell } from "@localapp/app-kit/dev-shell";
   import App from "/src/App.tsx";
   createRoot(document.getElementById("root")).render(
     <React.StrictMode><DevShell><App /></DevShell></React.StrictMode>
   );
   ```

`command === 'build'` 时所有钩子 SHALL no-op，不影响生产构建。

#### Scenario: transformIndexHtml 在 dev 模式激活
- **WHEN** 执行 `vite dev` 或 `vite`
- **AND** vite-plugin 检测到 `command === 'serve'`
- **THEN** transformIndexHtml 钩子被注册，处理 index.html 时替换 main.tsx 引用为虚拟模块

#### Scenario: transformIndexHtml 在 build 模式不激活
- **WHEN** 执行 `vite build`
- **AND** vite-plugin 检测到 `command === 'build'`
- **THEN** transformIndexHtml 钩子不修改 index.html，原 `<script src="/src/main.tsx">` 保留

#### Scenario: resolveId 识别虚拟模块
- **WHEN** vite 尝试 resolve `/virtual:localapp-dev`
- **THEN** vite-plugin 的 resolveId 钩子返回 `\0virtual:localapp-dev`（前缀 \0 标记虚拟）

#### Scenario: load 返回虚拟模块代码
- **WHEN** vite 请求加载 `\0virtual:localapp-dev`
- **THEN** vite-plugin 的 load 钩子返回包含 DevShell 和 App 导入的 ES 模块代码字符串
- **AND** 代码调用 `createRoot().render(<DevShell><App /></DevShell>)`

### Requirement: DevShell 顶部 nav 增加视觉锚点彩条

`init-repo/runtime/dev-shell.tsx` 的顶部 nav 栏 SHALL 在底部添加一条彩色渐变条，作为与 nav-shell 一致的视觉锚点：

- 高度：`h-[3px]`（与 nav-shell Navbar 底部彩条一致）
- 渐变色：`bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-orange-400`（与 nav-shell Navbar 完全一致）

DevShell 的其他元素（DEV 徽章、AI 按钮、tools 列表）保持当前样式不变。

#### Scenario: dev-shell 包含彩条
- **WHEN** 查看 `init-repo/runtime/dev-shell.tsx`
- **THEN** nav 标签内的最后一个子元素为 `<div className="h-[3px] bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-orange-400" />`

#### Scenario: dev-shell 视觉对齐 nav-shell
- **WHEN** dev 模式渲染 DevShell
- **THEN** 顶部 nav 底部出现与 nav-shell 完全一致的彩色渐变条
- **AND** 其他 dev-only 元素（DEV 徽章、AI 按钮）保持不变
