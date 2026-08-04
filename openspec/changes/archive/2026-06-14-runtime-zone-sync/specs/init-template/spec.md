## MODIFIED Requirements

### Requirement: 模板目录结构

`init-repo/` SHALL 为独立的 Vite + React 项目模板目录，包含完整的可运行项目骨架。模板不属于 pnpm workspace。模板 SHALL 分为「用户领地」（项目根 + `src/components/ui/` + `tests/`）和「CLI 领地」（`runtime/` + `.claude/skills/localapp-*/`）两部分。

#### Scenario: 模板目录验证
- **WHEN** 查看 `init-repo/` 目录
- **THEN** 包含 `package.json`、`vite.config.ts`、`index.html`、`tsconfig.json`、`CLAUDE.md`、`src/main.tsx`、`src/App.tsx`、`src/components/ui/`、`runtime/`、`.claude/skills/localapp-*/`

#### Scenario: 模板不在 pnpm workspace 中
- **WHEN** 查看 `pnpm-workspace.yaml`
- **THEN** 不包含 `init-repo` 目录

#### Scenario: 模板包含 runtime 子目录
- **WHEN** 查看 `init-repo/runtime/`
- **THEN** 包含 `vite-plugin.ts`、`dev-shell.tsx`、`lib/utils.ts`、`hooks/use-mobile.ts`、`styles/preset.css`、`tsconfig.base.json`（不含 `version.json`，该文件由 build.rs 在 staging 时生成）

### Requirement: SDK 源码预装

模板的 `.localapp/runtime/sdk/{core,react,agent}/` 目录 SHALL 包含完整的 SDK 源码（runtime/sdk 是 CLI 领地的一部分，由 staging 流程从 packages/sdk-* 复制而来）。SDK 源码 SHALL 通过 build.rs 在编译期 staging 时从 `packages/sdk-*` 同步到 `init-repo/runtime/sdk/`，不在 init-repo 源码中维护。`agent/context.ts` SHALL 导出 `buildSystemPrompt` 函数，接受三个参数：`systemContext`（系统层上下文）、`schemaContext`（数据层上下文）、`hint`（应用层提示）。`client.ts` SHALL 导出 `detectBasePath` 函数。

#### Scenario: SDK 源码可用
- **WHEN** 在模板的 `App.tsx` 中 import `{ useList, useMe }` from `'@localapp/sdk-react'`
- **THEN** TypeScript 编译通过（通过 package.json `file:` 引用解析到 `.localapp/runtime/sdk/react`），Vite 构建成功

#### Scenario: buildSystemPrompt 三参数接口
- **WHEN** 从 `@localapp/sdk-agent` 导入 `buildSystemPrompt`
- **THEN** 函数签名为 `(systemContext: string, schemaContext: string, hint?: string) => string`

#### Scenario: detectBasePath 导出
- **WHEN** 从 `@localapp/sdk` 导入 `detectBasePath`
- **THEN** 它是一个无参数函数，返回当前页面的 API basePath 字符串

#### Scenario: SDK 源码不在 init-repo 源码目录中
- **WHEN** 查看 `init-repo/` 源码（未编译）
- **THEN** `runtime/sdk/` 目录不存在（由 build.rs 编译期 staging 注入）

### Requirement: Vite 代理配置

模板的 `vite.config.ts` SHALL 仅包含 3 行：导入 vite、导入 localapp plugin（来自 `@localapp/app-kit/vite`）、调用 `defineConfig({ plugins: [localapp()] })`。代理逻辑（读 `.localapp/dev-config.json`、构 proxy、页面级 API 重写）SHALL 全部移入 `runtime/vite-plugin.ts`，由 `localapp()` plugin 在内部处理。

#### Scenario: vite.config.ts 极简
- **WHEN** 查看 `init-repo/vite.config.ts`
- **THEN** 文件仅约 3-5 行：`import { defineConfig } from "vite"`、`import { localapp } from "@localapp/app-kit/vite"`、`export default defineConfig({ plugins: [localapp()] })`，**不**直接读取 dev-config 或构 proxy

#### Scenario: 有 dev-config 时代理生效
- **WHEN** `.localapp/dev-config.json` 存在且包含 `{ "serverUrl": "http://192.168.1.100:3000" }`
- **THEN** `npm run dev` 时 `/api/me` 请求被代理到 `http://192.168.1.100:3000/api/me`（由 runtime/vite-plugin.ts 内部处理）

#### Scenario: 无 dev-config 时不报错
- **WHEN** `.localapp/dev-config.json` 不存在
- **THEN** `npm run dev` 正常启动，不配置 proxy，API 请求走本地（会 404）

#### Scenario: 生产构建不受影响
- **WHEN** 执行 `npm run build`
- **THEN** 构建成功，不包含 proxy 配置（proxy 仅在 dev server 生效）

### Requirement: Tailwind CSS 入口文件

模板 SHALL 包含 `src/index.css` 文件，内容为 `@import "@localapp/app-kit/styles/preset.css";`。`src/main.tsx` SHALL 导入该 CSS 文件。原有的 `@import "tailwindcss";`、`@import "tw-animate-css";`、`@import "shadcn/tailwind.css";` 等条目 SHALL 全部移入 `runtime/styles/preset.css`，由用户 `src/index.css` 通过单一 import 引用。

#### Scenario: index.css 存在且极简
- **WHEN** 查看 `init-repo/src/index.css`
- **THEN** 文件包含 `@import "@localapp/app-kit/styles/preset.css";` 以及用户自定义主题变量（如有），不再直接 import tailwindcss / shadcn

#### Scenario: main.tsx 导入 CSS
- **WHEN** 查看 `init-repo/src/main.tsx`
- **THEN** 文件顶部包含 `import "./index.css";`

#### Scenario: preset.css 包含完整 Tailwind 入口
- **WHEN** 查看 `init-repo/runtime/styles/preset.css`
- **THEN** 文件包含 `@import "tailwindcss";`、`@import "tw-animate-css";`、`@import "shadcn/tailwind.css";` 以及主题变量定义

### Requirement: .gitignore 配置

模板 SHALL 包含 `.gitignore` 文件，排除 `.localapp/dev-config.json`（本地开发配置，含服务器地址）、`.localapp/runtime/`（CLI 领地，可由 sync 重建）、`node_modules/`、`dist/`。

#### Scenario: dev-config 不被提交
- **WHEN** `.localapp/dev-config.json` 存在且执行 `git status`
- **THEN** 该文件不在未跟踪文件列表中（被 gitignore 排除）

#### Scenario: runtime 不被提交
- **WHEN** `.localapp/runtime/` 存在且执行 `git status`
- **THEN** 该目录不在未跟踪文件列表中（被 gitignore 排除），用户 clone 后通过 `npm install` 触发 postinstall 重建

### Requirement: 模板包含 shadcn 项目配置

`init-repo/` SHALL 包含 shadcn/ui 标准项目配置，包括 `components.json`、`src/lib/utils.ts`、主题 CSS 变量、TypeScript 路径别名和 Vite 路径别名。

`src/lib/utils.ts` 的 `cn()` 工具函数 SHALL 由 `@localapp/app-kit/lib/utils` 重新导出（实际实现在 `runtime/lib/utils.ts`），保持用户项目内 `@/lib/utils` 别名可用。这是为了兼容 shadcn `add` 命令按固定路径写入的预期。

#### Scenario: components.json 存在
- **WHEN** 查看 `init-repo/components.json`
- **THEN** 文件存在，并配置组件目录、工具函数路径、CSS 入口和 `@/*` aliases

#### Scenario: cn 工具函数存在
- **WHEN** 查看 `init-repo/src/lib/utils.ts`
- **THEN** 文件导出 `cn()` 函数（实际通过 `export { cn } from "@localapp/app-kit/lib/utils"` 重新导出），用于合并 className

#### Scenario: TypeScript alias 存在
- **WHEN** 查看 `init-repo/tsconfig.json`
- **THEN** 配置 `extends "@localapp/app-kit/tsconfig.base"`，并包含 `baseUrl` 和 `paths`，使 `@/*` 解析到 `src/*`

#### Scenario: Vite alias 存在
- **WHEN** 查看 `init-repo/runtime/vite-plugin.ts` 的 localapp plugin
- **THEN** plugin 内部配置 `resolve.alias`，使运行时和构建时都能解析 `@` 到 `src`

#### Scenario: 主题变量存在
- **WHEN** 查看 `init-repo/runtime/styles/preset.css`
- **THEN** 文件包含 shadcn 组件使用的颜色、半径和主题变量，并保留 Tailwind CSS 入口

### Requirement: CLI 内置模板包含 shadcn UI 文件

CLI 编译时嵌入的内置模板 SHALL 包含 shadcn/ui 组件源码、配置文件和 UI 指引文件，且初始化项目时不得遗漏隐藏目录中的 skill 文件。CLI 领地的 skill 文件 SHALL 采用 `localapp-*/SKILL.md` 目录形态。

#### Scenario: 内置模板包含组件文件
- **WHEN** 执行内置模板初始化流程
- **THEN** 目标项目包含 `components.json`、`src/components/ui/`、`src/lib/utils.ts` 和 `src/index.css`（用户领地）

#### Scenario: 内置模板包含 UI 指引
- **WHEN** 执行内置模板初始化流程
- **THEN** 目标项目包含 shadcn/ui 或 UI 组件开发相关的 AI 指引文件，位于 `.claude/skills/localapp-ui/SKILL.md`

#### Scenario: 内置模板包含 CLI 领地 runtime
- **WHEN** 执行内置模板初始化流程
- **THEN** 目标项目存在 `.localapp/runtime/`，包含 `vite-plugin.ts`、`dev-shell.tsx`、`lib/utils.ts`、`styles/preset.css`、`tsconfig.base.json`、`sdk/core|react|agent/`、`version.json`

#### Scenario: 初始化项目可构建
- **WHEN** 使用内置模板初始化项目并执行 `npm install`、`npm run build`
- **THEN** 项目安装和构建成功，shadcn 组件样式被正确编译

## ADDED Requirements

### Requirement: 模板包含 runtime 子目录承载 CLI 领地代码

`init-repo/runtime/` SHALL 作为 CLI 领地的源码根目录，包含所有「我们的」代码（不含 SDK 源码，SDK 由 build.rs staging 注入）。具体内容 SHALL 包括：

- `vite-plugin.ts` — 现 `vite.config.ts` 中的 proxy 构建、API 重写等逻辑
- `dev-shell.tsx` — 现 `src/dev-shell.tsx` 全量内容
- `lib/utils.ts` — 现 `src/lib/utils.ts`（cn 函数）
- `hooks/use-mobile.ts` — 现 `src/hooks/use-mobile.ts`
- `styles/preset.css` — 现 `src/index.css` 中 CLI 拥有的部分（Tailwind/shadcn 入口 + 主题变量）
- `tsconfig.base.json` — 现 `tsconfig.json` 中的 `compilerOptions` 部分（供用户 tsconfig.json extends）

#### Scenario: runtime/ 包含 vite-plugin
- **WHEN** 查看 `init-repo/runtime/vite-plugin.ts`
- **THEN** 文件导出 `localapp` 函数，返回 Vite `Plugin` 对象，内部处理 dev-config 读取和 proxy 构造

#### Scenario: runtime/ 包含 dev-shell
- **WHEN** 查看 `init-repo/runtime/dev-shell.tsx`
- **THEN** 文件导出 `DevShell` React 组件，包含完整的 dev 模式 AI 聊天侧栏、工具侧栏实现

#### Scenario: runtime/ 包含 tsconfig.base
- **WHEN** 查看 `init-repo/runtime/tsconfig.base.json`
- **THEN** 文件包含完整 `compilerOptions`（target、module、jsx、strict 等），可被用户 `tsconfig.json` 通过 `extends` 引用

### Requirement: 用户项目 src/main.tsx 极简化

模板的 `src/main.tsx` SHALL 极简化为约 5 行：导入 React、ReactDOM、DevShell（从 `@localapp/app-kit/dev-shell`）、App，渲染 `<DevShell><App /></DevShell>`。原有的 `import "./index.css"` 保留。所有 dev 模式逻辑（registry、AI 聊天）SHALL 封装在 DevShell 内部。

#### Scenario: main.tsx 极简引用 DevShell
- **WHEN** 查看 `init-repo/src/main.tsx`
- **THEN** 文件约 5 行：`import React from "react"`、`import ReactDOM from "react-dom/client"`、`import { DevShell } from "@localapp/app-kit/dev-shell"`、`import App from "./App.js"`、`import "./index.css"`，渲染 `<DevShell><App /></DevShell>`

#### Scenario: DevShell 自动判断 dev/prod
- **WHEN** 在 dev 环境（`import.meta.env.DEV` 为 true）运行
- **THEN** DevShell 渲染完整的 dev UI（navbar + sidebars + children）

#### Scenario: 生产构建剥离 dev UI
- **WHEN** 执行 `npm run build`
- **THEN** DevShell 在 prod 模式下仅渲染 children（dev UI 被 tree-shake 剥离）

### Requirement: 模板 runtime/package.json 声明导出映射

`init-repo/runtime/package.json` SHALL 声明 npm `exports` 字段，将子路径映射到对应文件，使用户可以通过 `@localapp/app-kit/<sub>` 形式导入：

- `@localapp/app-kit/vite` → `./vite-plugin.ts`
- `@localapp/app-kit/dev-shell` → `./dev-shell.tsx`
- `@localapp/app-kit/lib/utils` → `./lib/utils.ts`
- `@localapp/app-kit/styles/preset.css` → `./styles/preset.css`
- `@localapp/app-kit/tsconfig.base` → `./tsconfig.base.json`

#### Scenario: package.json exports 字段存在
- **WHEN** 查看 `init-repo/runtime/package.json`
- **THEN** `exports` 字段包含上述所有子路径映射

#### Scenario: 用户代码可按子路径导入
- **WHEN** 在用户项目的 `vite.config.ts` 中 `import { localapp } from "@localapp/app-kit/vite"`
- **THEN** 解析成功，TypeScript 和 Vite 都能找到对应模块
