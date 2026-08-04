## ADDED Requirements

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

#### Scenario: components.json 存在
- **WHEN** 查看 `init-repo/components.json`
- **THEN** 文件存在，并配置组件目录、工具函数路径、CSS 入口和 `@/*` aliases

#### Scenario: cn 工具函数存在
- **WHEN** 查看 `init-repo/src/lib/utils.ts`
- **THEN** 文件导出 `cn()` 函数，用于合并 className

#### Scenario: TypeScript alias 存在
- **WHEN** 查看 `init-repo/tsconfig.json`
- **THEN** `compilerOptions` 包含 `baseUrl` 和 `paths`，使 `@/*` 解析到 `src/*`

#### Scenario: Vite alias 存在
- **WHEN** 查看 `init-repo/vite.config.ts`
- **THEN** 配置 `resolve.alias`，使运行时和构建时都能解析 `@` 到 `src`

#### Scenario: 主题变量存在
- **WHEN** 查看 `init-repo/src/index.css`
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

CLI 编译时嵌入的内置模板 SHALL 包含 shadcn/ui 组件源码、配置文件和 UI 指引文件，且初始化项目时不得遗漏隐藏目录中的 skill 文件。

#### Scenario: 内置模板包含组件文件
- **WHEN** 执行内置模板初始化流程
- **THEN** 目标项目包含 `components.json`、`src/components/ui/`、`src/lib/utils.ts` 和更新后的 `src/index.css`

#### Scenario: 内置模板包含 UI 指引
- **WHEN** 执行内置模板初始化流程
- **THEN** 目标项目包含 shadcn/ui 或 UI 组件开发相关的 AI 指引文件

#### Scenario: 初始化项目可构建
- **WHEN** 使用内置模板初始化项目并执行 `npm install`、`npm run build`
- **THEN** 项目安装和构建成功，shadcn 组件样式被正确编译
