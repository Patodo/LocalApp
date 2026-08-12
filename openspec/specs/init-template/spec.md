## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the init-template capability in LocalApp.
## Requirements
### Requirement: 模板目录结构

`init-repo/` SHALL 在原结构基础上新增 `migrations/` 目录和 `db/seeds/` 目录,作为应用层 SQL migration 和 dev seed 的标准位置。模板 SHALL 包含一个初始 migration 文件 `migrations/001_init.sql` 作为示例。

```
init-repo/
├── migrations/                          ← 新增
│   └── 001_init.sql                     ← 示例初始 migration
├── db/
│   └── seeds/
│       └── dev.sql                      ← 示例 dev seed(可选)
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   └── components/ui/
├── runtime/
│   ├── vite-plugin.mjs
│   ├── dev-shell.tsx
│   └── ...
├── manifest.json                        ← 新增 platformVersion 字段
└── ...
```

#### Scenario: 模板包含 migrations 目录
- **WHEN** 执行 `localapp init my-app` 后查看目录
- **THEN** 项目包含 `migrations/` 目录
- **AND** 目录内含 `001_init.sql` 文件(模板预置)

#### Scenario: 模板包含 db/seeds 目录
- **WHEN** 查看模板目录
- **THEN** 包含 `db/seeds/dev.sql` 文件
- **AND** 文件含示例 INSERT 语句(被注释或为少量测试数据)

#### Scenario: runtime 不包含应用服务
- **WHEN** 查看 `runtime/` 目录
- **THEN** SHALL 只包含 DevShell、Vite plugin、SDK、样式和版本文件
- **AND** SHALL NOT 包含 HTTP Server 入口
- **AND** `localapp dev` SHALL 启动可发布的统一 Server 包

#### Scenario: manifest.json 包含 platformVersion
- **WHEN** 查看模板的 manifest.json
- **THEN** 文件含 `"platformVersion": "^1.0"` 字段
- **AND` business` 块为空对象或示例业务规则

### Requirement: 模板依赖配置

模板的 `package.json` SHALL 声明 `react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`typescript` 作为开发依赖，`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 作为运行时依赖。此外 SHALL 声明 `@assistant-ui/react` 作为运行时依赖，`tailwindcss` 和 `@tailwindcss/postcss` 作为开发依赖。不依赖任何外部 SDK npm 包。
模板的 `package.json` SHALL 将 `dev` 脚本设置为 `localapp dev`，并提供内部 `dev:vite` 脚本运行裸 Vite。CLI 在启动前端开发服务器时 SHALL 优先调用 `dev:vite`，避免 `dev` 脚本递归调用 `localapp dev`。
DevShell 的 Vite dependency prebundle SHALL 只 include 模板直接声明的 DevShell 依赖（如 `react-markdown`、`remark-gfm`），不得 include 未在模板 package.json 中直接声明的传递依赖。

#### Scenario: 安装依赖
- **WHEN** 在 `init-repo/` 目录执行 `npm install`
- **THEN** 成功安装所有依赖，无报错

#### Scenario: 构建项目
- **WHEN** 在 `init-repo/` 目录执行 `npm run build`
- **THEN** 生成 `dist/` 目录，包含可运行的 `index.html`，Tailwind CSS 被正确编译

#### Scenario: 默认开发入口启动 LocalApp dev
- **WHEN** 在 `init-repo/` 目录查看 `package.json`
- **THEN** `scripts.dev` SHALL 为 `localapp dev`
- **AND** `scripts.dev:vite` SHALL 启动 Vite

#### Scenario: DevShell 预打包不引用未声明传递依赖
- **WHEN** 新项目运行 Vite dev server
- **THEN** optimizeDeps.include SHALL NOT 包含 `style-to-js` 或 `debug` 等未直接声明依赖

#### Scenario: eject 后 dev 脚本恢复为裸 Vite
- **WHEN** 用户运行 `localapp eject`
- **THEN** `scripts.dev` SHALL 恢复为 eject 前保存的 `scripts.dev:vite`
- **AND** `scripts.dev:vite` 和 `postinstall` SHALL 被移除

### Requirement: SDK 源码预装

模板的 `.localapp/runtime/sdk/{core,react,agent}/` 目录 SHALL 包含完整的 SDK 源码（runtime/sdk 是 CLI 领地的一部分，由 npm package staging 流程从 packages/sdk-* 复制而来）。SDK 源码 SHALL 在 `localapp` 包构建阶段从 `packages/sdk-*` 同步到模板 staging，不在 init-repo 源码中维护。`agent/context.ts` SHALL 导出 `buildSystemPrompt` 函数，接受三个参数：`systemContext`（系统层上下文）、`schemaContext`（数据层上下文）、`hint`（应用层提示）。`client.ts` SHALL 导出 `detectBasePath` 函数。

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
- **THEN** `runtime/sdk/` 目录不存在（由 npm package build staging 注入）

### Requirement: 示例页面

模板 SHALL 包含一个示例 `App.tsx`，展示 SDK 的基本用法：查询访客身份、列表展示、创建记录。

#### Scenario: 示例页面包含 SDK 调用
- **WHEN** 查看 `init-repo/src/App.tsx`
- **THEN** 代码中使用 `useMe`、`useList`、`useCreate` 等 Hook，包含完整的 JSX 渲染逻辑

#### Scenario: 示例页面可构建
- **WHEN** 执行 `npm run build`
- **THEN** 示例页面成功构建为 `dist/index.html`，无编译错误

### Requirement: CLAUDE.md AI 助手指南

模板 SHALL 包含 `CLAUDE.md` 文件，面向 AI 助手说明平台能力和 SDK 用法。内容 SHALL 包含：平台能力概述、SDK Hook 参考文档（含 error 字段）、错误处理模式、认证跳转指南、CLI 命令参考、常见开发模式示例。

#### Scenario: CLAUDE.md 包含 Hook 文档
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含每个 Hook 的签名、参数说明和示例代码，包含 `error` 返回字段

#### Scenario: CLAUDE.md 包含错误处理说明
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含 `LocalAppError` 类型说明，以及使用 `error.status` 区分 401/403 的示例代码

#### Scenario: CLAUDE.md 包含登录跳转说明
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含 `redirectToLogin()` 函数的使用示例，说明如何在检测到 401 时引导用户登录

#### Scenario: CLAUDE.md 包含 CLI 命令
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含 `localapp dev`、`localapp check --json`、`localapp build --package` 和 `localapp app install --target <profile>` 等常用命令说明

#### Scenario: CLAUDE.md 包含访问控制说明
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档说明页面级和路由级访问控制的配置方法

### Requirement: Vite 代理配置

模板的 `vite.config.ts` SHALL 仅包含 3 行：导入 vite、导入 localapp plugin（来自 `@localapp/app-kit/vite`）、调用 `defineConfig({ plugins: [localapp()] })`。代理逻辑（读 `.localapp/dev-config.json`、构 proxy、页面级 API 重写）SHALL 全部移入 `runtime/vite-plugin.ts`，由 `localapp()` plugin 在内部处理。

#### Scenario: vite.config.ts 极简
- **WHEN** 查看 `init-repo/vite.config.ts`
- **THEN** 文件仅约 3-5 行：`import { defineConfig } from "vite"`、`import { localapp } from "@localapp/app-kit/vite"`、`export default defineConfig({ plugins: [localapp()] })`，**不**直接读取 dev-config 或构 proxy

#### Scenario: canonical dev-config 代理生效
- **WHEN** `localapp dev` 写入包含 `serverUrl`、`userId`、`pageName`、`apiKey` 和 `appServerPort` 的 `.localapp/dev-config.json`
- **THEN** `npm run dev:vite` SHALL 把 `/api/me` 等平台 API 代理到 `serverUrl`
- **AND** SHALL 把应用 API 改写到同一 Server 的 `/serve/<userId>/<pageName>/api/*`

#### Scenario: dev-config 缺失或不完整时失败
- **WHEN** 开发 Server 启动时 `.localapp/dev-config.json` 不存在或缺少任一必需字段
- **THEN** `npm run dev:vite` SHALL 以可操作错误终止
- **AND** SHALL 提示先运行 `localapp dev`
- **AND** SHALL NOT 静默启动一个没有 canonical Server 后端的页面

#### Scenario: 生产构建不受影响
- **WHEN** 执行 `npm run build`
- **THEN** 构建成功，不包含 proxy 配置（proxy 仅在 dev server 生效）

### Requirement: .gitignore 配置

模板 SHALL 包含 `.gitignore` 文件，排除 `.localapp/dev-config.json`（本地开发配置，含服务器地址）、`.localapp/runtime/`（CLI 领地，可由 sync 重建）、`node_modules/`、`dist/`。

#### Scenario: dev-config 不被提交
- **WHEN** `.localapp/dev-config.json` 存在且执行 `git status`
- **THEN** 该文件不在未跟踪文件列表中（被 gitignore 排除）

#### Scenario: runtime 不被提交
- **WHEN** `.localapp/runtime/` 存在且执行 `git status`
- **THEN** 该目录不在未跟踪文件列表中（被 gitignore 排除），用户 clone 后通过 `npm install` 触发 postinstall 重建

### Requirement: CLAUDE.md 包含 useUpload Hook 文档

`init-repo/CLAUDE.md` SHALL 包含 `useUpload()` Hook 的完整文档，包括函数签名、参数说明、返回值类型（`{ upload, loading, error }`）、`UploadResult` 结构（`{ key: string, url: string }`）和使用示例。

#### Scenario: CLAUDE.md 包含 useUpload 文档
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档包含 `useUpload()` Hook 的 TypeScript 示例代码、返回值说明、以及 `UploadResult` 的 key/url 结构

#### Scenario: CLAUDE.md 包含文件上传模式示例
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档包含一个完整的"文件上传 + 表单提交"组合模式示例，展示如何在上传后获取 URL 并存入数据记录

#### Scenario: CLAUDE.md 包含上传错误处理
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档包含 try/catch 捕获上传错误的示例代码，使用 `LocalAppError` 类型

### Requirement: LLM Adapter 传递系统提示词和工具定义

`agent/llm-adapter.ts` 的 `createStreamFn` SHALL 将 `context.systemPrompt` 作为第一条 system message 传递给 LLM API，并将 `context.tools` 转为 OpenAI function calling 格式传递。

#### Scenario: 系统提示词传递给 LLM
- **WHEN** Agent 的 `context.systemPrompt` 为非空字符串
- **THEN** 发送给 `/api/llm/chat` 的请求体 `messages` 数组中第一条为 `{ role: "system", content: systemPrompt }`

#### Scenario: 工具定义传递给 LLM
- **WHEN** Agent 的 `context.tools` 包含工具定义
- **THEN** 发送给 `/api/llm/chat` 的请求体包含 `tools` 字段，格式为 OpenAI function calling 的 `tools` 数组

#### Scenario: 无工具定义时不传 tools 字段
- **WHEN** Agent 的 `context.tools` 为 undefined 或空数组
- **THEN** 发送给 `/api/llm/chat` 的请求体中 `tools` 字段为 undefined

### Requirement: Agent 系统工具使用页面级 API 路径

模板的 Agent 系统工具 SHALL NOT 重新提供通用 `queryData` 或 `listSchemas` 数据探查工具。应用数据访问 SHALL 继续通过 SDK hooks/client、registered named SQL 和应用通过 `useRegisterTools` 暴露的明确业务工具完成。模板文档 SHALL 将 `/{userId}/{name}` 描述为安装后的正式验证入口，不得要求 agent 通过 `/serve/{userId}/{name}/` 验收应用功能。

#### Scenario: 系统工具不提供 queryData
- **WHEN** 应用初始化后调用 `createSystemTools()`
- **THEN** 返回的系统工具列表 SHALL NOT 包含 `queryData`
- **AND** 应用如需让 Agent 查询业务数据 SHALL 注册受控的业务工具

#### Scenario: 系统工具不提供 listSchemas
- **WHEN** 应用初始化后调用 `createSystemTools()`
- **THEN** 返回的系统工具列表 SHALL NOT 包含 `listSchemas`
- **AND** schema 信息 SHALL 通过应用代码、SDK 类型或明确注册的业务工具按需暴露

#### Scenario: 安装后验证使用正式 Shell route
- **WHEN** 应用安装后需要验收用户可见功能
- **THEN** 模板文档 SHALL 指示访问 `/{userId}/{name}`
- **AND** 模板文档 SHALL NOT 将 `/serve/{userId}/{name}/` 描述为默认功能验收入口

### Requirement: PostCSS 配置

模板 SHALL 包含 `postcss.config.js`，配置 `@tailwindcss/postcss` 插件。

#### Scenario: PostCSS 配置文件存在且正确
- **WHEN** 查看 `init-repo/postcss.config.js`
- **THEN** 文件导出包含 `@tailwindcss/postcss` 插件的对象

#### Scenario: Vite 自动使用 PostCSS
- **WHEN** 执行 `npm run build` 或 `npm run dev`
- **THEN** Vite 自动检测 postcss.config.js 并处理 CSS，无需额外 Vite 插件配置

### Requirement: Tailwind CSS 入口文件

模板 SHALL 包含 `src/index.css` 文件，内容为 `@import "@localapp/app-kit/styles/preset.css";`。`src/main.tsx` SHALL 导入该 CSS 文件。原有的 `@import "tailwindcss";`、`@import "tw-animate-css";`、`@import "shadcn/tailwind.css";` 等条目 SHALL 全部移入 `runtime/styles/preset.css`，由用户 `src/index.css` 通过单一 import 引用。

`runtime/styles/preset.css` SHALL 同时提供 DevShell 运行所需的稳定样式 token。DevShell SHALL NOT 依赖 Tailwind 默认 palette 是否存在；用于 DevShell 的颜色、边框、强调色和视觉锚点 SHALL 由 LocalApp runtime 明确定义的语义 token 或 `localapp-dev` 专属 token 提供。

#### Scenario: index.css 存在且极简
- **WHEN** 查看 `init-repo/src/index.css`
- **THEN** 文件包含 `@import "@localapp/app-kit/styles/preset.css";` 以及用户自定义主题变量（如有），不再直接 import tailwindcss / shadcn

#### Scenario: main.tsx 导入 CSS
- **WHEN** 查看 `init-repo/src/main.tsx`
- **THEN** 文件顶部包含 `import "./index.css";`

#### Scenario: preset.css 包含完整 Tailwind 入口
- **WHEN** 查看 `init-repo/runtime/styles/preset.css`
- **THEN** 文件包含 `@import "tailwindcss";`、`@import "tw-animate-css";`、`@import "shadcn/tailwind.css";` 以及主题变量定义

#### Scenario: preset.css 提供 DevShell 专属 token
- **WHEN** 查看 `init-repo/runtime/styles/preset.css`
- **THEN** 文件包含 `--localapp-dev`、`--localapp-dev-foreground`、`--localapp-dev-muted`、`--localapp-dev-muted-foreground`、`--localapp-dev-border`、`--localapp-dev-accent`、`--localapp-dev-accent-foreground`
- **AND** 文件包含对应的 Tailwind theme 映射，使 `bg-localapp-dev-*`、`text-localapp-dev-*`、`border-localapp-dev-*` 可被生成

#### Scenario: 单一 import 可生成 DevShell 样式
- **WHEN** 用户项目的 `src/index.css` 只导入 `@localapp/app-kit/styles/preset.css`
- **AND** DevShell 源码使用 `localapp-dev` token class
- **THEN** Vite/Tailwind 编译产物 SHALL 包含 DevShell 关键 token utility
- **AND** DevShell 关键元素 SHALL NOT 因缺少 Tailwind 默认 palette 而退回透明背景或默认黑色文本

### Requirement: assistant-ui 消息格式适配器

`src/lib/localapp/agent/assistant-ui-adapter.ts` SHALL 导出 `convertMessages` 函数，将 pi-agent-core 的 `AgentMessage[]` 转换为 assistant-ui 的 `ThreadMessageLike[]`。

#### Scenario: 适配器文件存在且导出正确
- **WHEN** 从 `./lib/localapp/agent/assistant-ui-adapter` 导入 `convertMessages`
- **THEN** 函数接受 `AgentMessage[]` 参数，返回 `ThreadMessageLike[]`

### Requirement: 模板 Skills 包含图片上传指引

`init-repo/.claude/skills/` SHALL 包含图片上传相关的开发指引文件，说明如何使用 `useUpload` hook、支持的文件类型、大小限制，以及在表单中集成图片上传的完整示例。

#### Scenario: Skills 文件存在
- **WHEN** 查看 `init-repo/.claude/skills/` 目录
- **THEN** 包含图片上传相关的 skill 文件（如 `localapp-upload.md`）

#### Scenario: Skill 包含完整示例
- **WHEN** AI Agent 阅读 upload skill
- **THEN** 文档包含 `useUpload` 的 TypeScript 示例代码，展示在表单中上传图片并将 key 存入数据记录的完整流程

#### Scenario: Skill 包含限制说明
- **WHEN** AI Agent 阅读 upload skill
- **THEN** 文档说明支持的文件类型（png、jpg、jpeg、gif、webp、svg、pdf）和 10MB 大小限制

### Requirement: CLAUDE.md 包含醒目的开发与安装工作流章节

`init-repo/CLAUDE.md` SHALL 在「平台概述」之后、所有能力介绍之前，包含「开发工作流」章节。该章节 SHALL 说明 `localapp dev` 使用项目 canonical Server，并列出 `localapp check --json` 与 `localapp app install --target <profile>` 的正式安装流程。

#### Scenario: 部署章节位置
- **WHEN** 阅读 CLAUDE.md 文档
- **THEN** 「开发工作流」章节为文档的第二个一级章节（紧接「平台概述」之后）

#### Scenario: 部署步骤内容
- **WHEN** 阅读「开发工作流」章节
- **THEN** 章节包含 `localapp dev`、`localapp check --json` 和 `localapp app install --target <profile>`
- **AND** 明确正式功能验收使用 Server 返回的 `/<owner>/<app>/` URL

#### Scenario: 表单可访问性规范
- **WHEN** 阅读 CLAUDE.md 中的表单代码示例
- **THEN** 示例中的 `<label>` 使用 `htmlFor` 属性关联到对应 `<input>` 的 `id`

### Requirement: 模板预置 shadcn UI 全量组件

`init-repo/` SHALL 预置 shadcn/ui 组件源码和运行所需依赖，使初始化后的应用开发者可以直接从 `@/components/ui/*` 引用组件，无需再运行 `shadcn add` 才能使用组件。

#### Scenario: shadcn 组件目录存在
- **WHEN** 查看 `init-repo/src/components/ui/` 目录
- **THEN** 目录包含 shadcn/ui 全量组件源码文件，包括 `button`、`input`、`label`、`textarea`、`card`、`dialog`、`select`、`tabs`、`table`、`badge`、`popover`、`command`、`calendar`、`sheet`、`sidebar` 等组件

#### Scenario: shadcn 依赖可安装
- **WHEN** 在 `init-repo/` 目录执行 `npm install`
- **THEN** shadcn 组件所需的 Radix、class-variance-authority、clsx、tailwind-merge、lucide-react 等依赖被成功安装

#### Scenario: shadcn 组件可引用
- **WHEN** 在模板应用中使用 `import { Button } from "@/components/ui/button"`
- **THEN** TypeScript 编译通过，Vite 构建成功

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

### Requirement: 模板包含 shadcn UI 开发指引

`init-repo/` SHALL 在 AI 助手指引中说明 shadcn/ui 的使用规则。指引 SHALL 明确全量组件可用，但 Agent 默认优先使用基础组件组合业务 UI，复杂组件仅在需求明确匹配时使用。

#### Scenario: CLAUDE.md 包含 UI 指引入口
- **WHEN** 阅读 `init-repo/CLAUDE.md` 的深入指南
- **THEN** 文档包含 shadcn/ui 或 UI 组件开发相关 skill 的入口说明

#### Scenario: UI skill 文件存在
- **WHEN** 查看 `init-repo/.claude/skills/` 目录
- **THEN** 目录包含 shadcn/ui 或 UI 组件开发相关 skill 文件

#### Scenario: 基础组件优先约束
- **WHEN** AI Agent 阅读 UI skill
- **THEN** 文档要求默认优先使用 `Button`、`Input`、`Label`、`Textarea`、`Card`、`Table`、`Badge`、`Dialog`、`Select`、`Tabs` 等基础组件构建业务界面

#### Scenario: 复杂组件按场景使用
- **WHEN** AI Agent 阅读 UI skill
- **THEN** 文档说明 `Command`、`Popover`、`Calendar`、`Carousel`、`Resizable`、`Navigation Menu`、`Sidebar` 等复杂组件仅在用户需求明确需要对应交互时使用

### Requirement: 示例页面展示 shadcn 与 LocalApp SDK 组合模式

模板默认 `App.tsx` SHALL 使用 shadcn 基础组件展示 LocalApp SDK 的推荐业务应用模式，包括当前用户、列表状态、创建表单、加载状态、错误状态和空状态。

#### Scenario: 示例页面使用 shadcn 基础组件
- **WHEN** 查看 `init-repo/src/App.tsx`
- **THEN** 代码从 `@/components/ui/*` 导入并使用 shadcn 基础组件

#### Scenario: 示例页面保留 SDK 调用
- **WHEN** 查看 `init-repo/src/App.tsx`
- **THEN** 代码仍使用 `useMe`、`useList`、`useCreate` 等 LocalApp SDK Hook 展示平台数据开发模式

#### Scenario: 示例页面不展示组件陈列
- **WHEN** 查看默认示例页面
- **THEN** 页面是一个可运行的业务应用示例，而不是 shadcn 全量组件展示或文档页面

### Requirement: CLI 内置模板包含 shadcn UI 文件

`localapp` npm 包中的内置模板 SHALL 包含 shadcn/ui 组件源码、配置文件和 UI 指引文件，且初始化项目时不得遗漏隐藏目录中的 skill 文件。CLI 领地的 skill 文件 SHALL 采用 `localapp-*/SKILL.md` 目录形态。

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

### Requirement: 模板包含业务应用建模指引

`init-repo/` SHALL 包含面向 AI Agent 和应用开发者的业务应用建模指引，说明如何把 schema、当前用户、记录级权限、SDK Hook 和 shadcn/ui 组合成可用业务应用。

#### Scenario: CLAUDE.md 包含业务建模入口
- **WHEN** 阅读 `init-repo/CLAUDE.md`
- **THEN** 文档 SHALL 在深入指南或核心规则中包含业务应用建模 skill 的入口说明

#### Scenario: 业务建模 skill 文件存在
- **WHEN** 查看 `init-repo/.claude/skills/`
- **THEN** 目录 SHALL 包含业务应用建模相关 skill 文件

### Requirement: 模板示例展示业务模型和权限判断

模板的 work_items 示例 SHALL 通过完整声明 named SQL 展示业务应用建模的标准形态。示例 SHALL 包含覆盖完整 CRUD 操作的 6 条 named SQL：
- `$work_items.list`（query，支持 offset/limit/sort/order/filters）
- `$work_items.get`（query，按 id）
- `$work_items.count`（query，支持 filters）
- `$work_items.create`（mutation，覆盖所有业务字段，`created_by_member_id` 通过子查询从当前用户推导）
- `$work_items.update`（mutation，按 id 部分更新）
- `$work_items.delete`（mutation，按 id）

示例 SHALL NOT 依赖任何 REST CRUD 路径或 SDK fallback 行为。模板内任何文档/skill 引用 SHALL 明确说明"所有数据操作必须通过 named SQL"。

#### Scenario: 模板含完整 named SQL 声明

- **WHEN** 应用从模板初始化后查看 `backend/resources/work_items/`
- **THEN** SHALL 看到 `queries.json` 含 `$work_items.list` / `$work_items.get` / `$work_items.count`
- **AND** SHALL 看到 `mutations.json` 含 `$work_items.create` / `$work_items.update` / `$work_items.delete`

#### Scenario: 模板 SDK 调用走 named SQL

- **WHEN** 示例前端代码调用 `client.list('work_items')` 或 `client.create('work_items', data)`
- **THEN** 调用路径 SHALL 命中对应的 named SQL（`$work_items.list` / `$work_items.create`）
- **AND** 不得触发任何 REST CRUD fallback

### Requirement: CLI 内置模板包含业务建模指引

`localapp` npm 包中的内置模板 SHALL 包含业务建模 skill、更新后的 `CLAUDE.md` 和示例代码。

#### Scenario: 使用 builtin 模板初始化项目
- **WHEN** 使用 CLI 的 builtin init-repo 模板初始化应用
- **THEN** 目标项目 SHALL 包含业务建模指引文件和更新后的默认示例

### Requirement: 模板示例展示 transition UI 模式

模板的 work_items 示例 SHALL 展示基于 named SQL + 前端 SDK 本地计算的状态流转 UI 模式。示例 SHALL：
- 在 `schema.json` 声明 `business.transitions` 作为前端元数据
- 在 `mutations.json` 声明对应的 named mutation（如 `$work_items.approve`）作为实际执行入口
- 前端代码使用 `client.availableTransitions('work_items', record)` 计算当前可执行动作
- 前端代码使用 `client.mutate('$work_items.<action>', { id })` 执行流转

示例 SHALL NOT 使用任何已移除的 transition 端点（`GET /api/<resource>/:id/transitions` 等）。

#### Scenario: 模板展示状态机声明与执行分离

- **WHEN** 应用从模板初始化后查看 work_items 的状态流转实现
- **THEN** SHALL 在 `schema.json` 看到 `business.transitions` 声明（前端元数据用途）
- **AND** SHALL 在 `mutations.json` 看到对应的 named mutation（含 SQL 状态守卫）
- **AND** SHALL 在前端代码看到 `availableTransitions` + `mutate` 的组合调用

### Requirement: 模板包含 runtime 子目录承载 CLI 领地代码

`init-repo/runtime/` SHALL 作为 CLI 领地的源码根目录，包含所有「我们的」代码（不含 SDK 源码，SDK 由 npm package build staging 注入）。具体内容 SHALL 包括：

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

`init-repo/runtime/dev-shell.tsx` 的顶部 nav 栏 SHALL 在底部添加一条 3px 高的彩色视觉锚点条，作为与 nav-shell 一致的视觉锚点：

- 高度：`h-[3px]`（与 nav-shell Navbar 底部彩条一致）
- 颜色来源：LocalApp runtime preset 明确定义的稳定 token 或 `localapp-dev` 专属 token

DevShell 的视觉锚点、DEV 徽章、AI 按钮和 tools 列表 SHALL NOT 依赖 Tailwind 默认 palette class（例如 `from-indigo-*`、`via-fuchsia-*`、`to-orange-*`），并 SHALL 使用 runtime 提供的语义 token 或 DevShell 专属 token 保持稳定样式。

#### Scenario: dev-shell 包含彩条
- **WHEN** 查看 `init-repo/runtime/dev-shell.tsx`
- **THEN** nav 标签内包含一条 `h-[3px]` 的视觉锚点元素
- **AND** 该元素的颜色 class SHALL 来自 LocalApp runtime token 或 `localapp-dev` 专属 token

#### Scenario: dev-shell 视觉对齐 nav-shell
- **WHEN** dev 模式渲染 DevShell
- **THEN** 顶部 nav 底部出现与 nav-shell 语义一致的彩色视觉锚点条
- **AND** 其他 dev-only 元素（DEV 徽章、AI 按钮）具有稳定可见的 token 样式

### Requirement: 模板 runtime 交付 nav-shell 对齐的 DevShell

`init-repo/runtime/dev-shell.tsx` SHALL 交付 nav-shell 对齐后的 DevShell。新建项目和执行 `localapp sync` 的现有项目 SHALL 获得相同的 `DEV` 下拉入口、平台外壳顶栏结构和开发工具面板能力。

#### Scenario: init 模板包含 DEV 下拉
- **WHEN** 用户使用新版 CLI 执行 `localapp init`
- **THEN** 初始化项目的 runtime SHALL 包含 `DEV` 按钮
- **AND** runtime SHALL 将工具列表入口和开发工具入口收纳在 `DEV` 下拉菜单中
- **AND** runtime SHALL NOT 在顶栏中平铺显示 `工具 N` 和 `开发工具` 两个按钮

#### Scenario: sync 更新现有项目 DevShell
- **WHEN** 现有项目执行新版 `localapp sync`
- **THEN** `.localapp/runtime/dev-shell.tsx` SHALL 更新为 nav-shell 对齐版本
- **AND** `.localapp/runtime/styles/preset.css` SHALL 包含该版本所需的稳定样式 token

#### Scenario: 模板测试防止入口回退
- **WHEN** 测试扫描 `init-repo/runtime/dev-shell.tsx`
- **THEN** 测试 SHALL 验证存在最左侧 `DEV` 按钮和下拉菜单
- **AND** 测试 SHALL 验证不存在顶栏平铺的 `开发` 徽章、`工具 N` 按钮和 `开发工具` 按钮

#### Scenario: 生产构建仍隔离 DevShell
- **WHEN** 用户执行 `npm run build`
- **THEN** 生产产物 SHALL NOT 包含 DevShell、`DEV` 下拉、`@localapp/app-kit/dev-shell` 或 `/api/dev/*` 标识

### Requirement: 模板预置示例 migration 文件

模板 SHALL 在 `migrations/001_init.sql` 提供示例 SQL,展示如何创建应用初始表。示例 SHALL 包含至少一个 CREATE TABLE 语句和索引。

示例 migration 文件内容(参考):

```sql
-- migrations/001_init.sql
-- 应用初始 schema,根据业务需要修改

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
```

#### Scenario: 示例 migration 可执行
- **WHEN** 用户 `localapp init my-app` 后执行 `localapp db migrate`
- **THEN** 示例 001_init.sql 成功应用到 `tmp/localapp-schema/schema.db` 离线工作库
- **AND` tasks` 表存在,有相应字段
- **AND` idx_tasks_status` 索引存在

#### Scenario: 示例 seed 文件可选应用
- **WHEN** 用户编辑 `db/seeds/dev.sql` 加入测试数据
- **AND` localapp db reset`
- **THEN` tmp/localapp-schema/schema.db` 包含 seed 数据
- **AND` tasks` 表有示例记录

### Requirement: 模板通过 Vite 接入统一 Server

模板 SHALL 只提供 Vite plugin 和 DevShell。Vite plugin SHALL 从 `.localapp/dev-config.json` 读取唯一 Server URL，把应用 API 改写到已安装应用作用域，把平台和开发工具 API 原样转发到同一 Server，并注入认证与开发应用 header。模板 SHALL NOT 实现、缓存或 mock Server API。

#### Scenario: 本地开发 API 走同一 Server
- **WHEN** 用户运行 `localapp dev` 并从 Vite 页面请求应用、用户、上传或 `/api/dev/*`
- **THEN** 所有请求 SHALL 到达 `.localapp/dev-config.json` 中同一个 `serverUrl`
- **AND** 应用 API SHALL 使用正式 `/serve/<owner>/<app>/api/*` 契约
- **AND** 平台数据 SHALL 来自项目 Server 的真实用户和群组

### Requirement: 模板示例 main.tsx 不感知 Server 编排

模板的 `src/main.tsx` SHALL 保持只 render App，不引用 Server 启动代码。统一 Server 由 CLI 在 `localapp dev` 时启动，对应用代码透明。

#### Scenario: main.tsx 不包含 Server 启动代码
- **WHEN** 查看模板的 `src/main.tsx`
- **THEN** 文件只包含 `render(<App />)`，无 Server 进程或代理配置
- **AND** DevShell 由 vite-plugin 虚拟模块注入(详见 dev-shell-injection spec)

### Requirement: init-repo 示例遵守 native 边界
init-repo 示例应用 SHALL 遵守 native app container 边界，不实现自己的平台导航栏，不仿冒平台登录入口，不直接操作平台 shell DOM。

#### Scenario: 示例应用不包含平台导航
- **WHEN** 检查 init-repo 示例源码
- **THEN** 示例应用 SHALL NOT 渲染替代平台 nav-shell 的顶部导航
- **AND** 示例应用 SHALL 依赖平台 shell 提供用户入口和 AI 入口

### Requirement: init-repo skills 使用 native 指南
init-repo skills SHALL 指导 Agent 生成 native 友好的应用：平台能力走 SDK、样式限制在应用容器内、数据访问走 backend contract 和 Named SQL。

#### Scenario: skills 不提 iframe 限制
- **WHEN** 检查 init-repo skills
- **THEN** skills SHALL NOT 建议使用 `window.parent`、iframe postMessage 或 sandbox workaround
- **AND** skills SHALL 建议使用 SDK 平台能力

### Requirement: Init template includes backend contract directory

init-repo SHALL include a default backend directory containing resource schema files, system CRUD named SQL definitions, custom SQL examples and local JSON Schema files.

#### Scenario: new project initialized
- **WHEN** user runs `localapp init`
- **THEN** generated project MUST contain a backend contract directory with examples and `$schema` references

#### Scenario: developer opens backend JSON
- **WHEN** developer opens a backend JSON file in an editor that understands JSON Schema
- **THEN** the file SHOULD provide validation and completion through its `$schema` reference

### Requirement: Init skills teach backend contract model

init-repo skills SHALL explain that application-level SQLite APIs are maintained as backend contract files and that platform data APIs remain platform-owned.

#### Scenario: app developer needs custom query
- **WHEN** app developer asks an agent to add a custom SQL-backed data view
- **THEN** skills MUST instruct the agent to add or modify a named SQL backend contract file instead of placing SQL in frontend code

#### Scenario: app developer needs platform users
- **WHEN** app developer needs platform user information
- **THEN** skills MUST instruct the agent to use platform-provided APIs rather than querying platform SQLite through backend SQL

### Requirement: 模板不包含 hosted action 示例
init template SHALL teach named SQL-first backend development and SHALL NOT include hosted action source, manifest, bundle, or default examples.

#### Scenario: 模板包含 actions 目录
- **WHEN** 执行 `localapp init leave-form`
- **THEN** 项目 MUST NOT 包含 `backend/actions/` 示例目录、`actions.manifest.json` 或 `actions.bundle.mjs`
- **AND** 示例 SHALL 展示 named query and named mutation contract files

#### Scenario: CLAUDE.md 包含 action 指南
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档 MUST 说明复杂业务逻辑应优先表达为 named mutation、transaction mutation 或平台原语
- **AND** 文档 MUST instruct agents to report platform primitive gaps instead of creating hosted actions

### Requirement: 模板不暴露 backend action 类型入口
模板 SHALL NOT add `@localapp/backend` as a default dependency for stable app development.

#### Scenario: action 类型可编译
- **WHEN** 新项目从模板初始化
- **THEN** `package.json` MUST NOT include `@localapp/backend`

#### Scenario: 前端调用 action 示例
- **WHEN** 查看示例前端代码或文档
- **THEN** MUST NOT 包含 `client.action()` 或 `useAction()` 调用示例

### Requirement: Named SQL-first backend guidance
`init-repo/` SHALL document that named SQL, named mutation, transaction mutation, and platform primitives are the stable server-side backend path.

#### Scenario: AI assistant reads CLAUDE.md
- **WHEN** AI 或应用开发者阅读 `init-repo/CLAUDE.md`
- **THEN** 文档 MUST 明确普通读写优先使用 named SQL
- **AND** 文档 MUST 明确 hosted action is disabled in stable LocalApp
- **AND** 文档 MUST instruct developers to report missing platform primitives when named SQL is insufficient

### Requirement: Template examples prefer lightweight backend paths
模板示例 SHALL demonstrate named SQL for ordinary reads and named mutation for short write orchestration.

#### Scenario: 示例应用展示列表数据
- **WHEN** 模板或示例应用需要展示列表
- **THEN** 示例 MUST use a named query with pagination or filtering
- **AND** 示例 MUST NOT use an action to fetch and assemble an unpaginated full list
