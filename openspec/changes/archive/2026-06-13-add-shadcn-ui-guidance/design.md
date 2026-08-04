## Context

`init-repo/` 是 LocalApp 应用开发的起点，面向两类使用者：直接编写代码的应用开发者，以及根据模板和指引生成应用的 AI Agent。当前模板已经具备 Vite、React、TypeScript、Tailwind v4、LocalApp SDK、Agent SDK 和平台能力文档，但 UI 层主要依赖手写 Tailwind，缺少可复用的组件源码、主题变量和组件选择规则。

本变更需要在不改变平台 API、不改变 SDK 使用方式的前提下，为模板提供完整的 shadcn/ui 组件源码和明确的 Agent 文件引导。全量组件用于降低开发者启用成本；约束文档用于避免 Agent 因可用组件过多而生成复杂、散乱或不符合业务场景的界面。

## Goals / Non-Goals

**Goals:**

- 在 `init-repo/` 中预置 shadcn/ui 全量组件源码，使初始化后的应用无需再次运行 `shadcn add` 即可引用组件。
- 保持模板仍是独立 Vite + React 项目，`npm install` 和 `npm run build` 必须可用。
- 增加 `components.json`、`src/lib/utils.ts`、`@/*` 路径别名和主题 CSS 变量，形成标准 shadcn 项目结构。
- 增加面向 AI Agent 的 UI skill 或指引文件，要求默认优先使用基础组件，复杂组件只在明确交互场景下使用。
- 更新默认 `App.tsx`，展示 LocalApp SDK 与 shadcn 基础组件组合业务应用的推荐写法。

**Non-Goals:**

- 不引入后端 API、数据库 schema 或上传协议变更。
- 不把 shadcn 组件抽成独立 npm 包，也不建立跨项目共享 UI 包。
- 不要求模板默认展示所有 shadcn 组件的演示页。
- 不改变 LocalApp SDK 的导入路径、Hook 接口或 Agent 工具执行模型。

## Decisions

### 决策 1：全量预置组件源码，而不是按需安装

全量组件放在 `init-repo/src/components/ui/`。这样应用开发者和 Agent 在初始化项目后可以直接引用任意 shadcn 组件，不依赖网络、CLI 交互或额外安装步骤。

备选方案是仅预置基础组件，再让开发者按需运行 `npx shadcn@latest add <component>`。该方案模板更轻，但会增加 AI 自动开发时的网络依赖和失败点，也与“随应用开发者需求启用”的目标不一致。

### 决策 2：用文档约束组件选择，而不是减少可用组件

模板 SHALL 增加 UI 指引，说明默认使用 `Button`、`Input`、`Label`、`Textarea`、`Card`、`Table`、`Badge`、`Dialog`、`Select`、`Tabs` 等基础组件构建业务页面。`Command`、`Popover`、`Calendar`、`Carousel`、`Resizable`、`Navigation Menu`、`Sidebar` 等复杂组件只有在用户需求明确匹配时使用。

这样既保留全量组件的便利性，又给 Agent 一个稳定的默认选择路径。

### 决策 3：采用 shadcn 标准目录和 `@/*` alias

模板 SHALL 使用 `@/components/ui/...`、`@/lib/utils` 这类 shadcn 常见导入路径。为此需要在 `tsconfig.json` 增加 `baseUrl` 和 `paths`，并在 `vite.config.ts` 增加 `resolve.alias`。

备选方案是使用相对路径导入，避免 alias 配置。但 shadcn 组件源码、示例和社区惯例都以 `@/*` 为主，使用标准路径更利于 Agent 迁移官方示例和开发者理解。

### 决策 4：默认示例只展示基础组件和平台能力

默认 `App.tsx` SHALL 使用少量基础组件展示一个可构建、可读、可模仿的业务应用骨架，例如身份展示、列表、表单创建、空状态和加载状态。即使组件目录全量存在，示例页面也不展示全部组件，避免将模板变成组件陈列页。

### 决策 5：AI 指引采用文件入口

模板 SHALL 在 `CLAUDE.md` 的深入指南中增加 UI 指引入口，并在 `.claude/skills/` 下增加 shadcn/UI 相关 skill。若后续需要支持 Codex 的原生入口，可在实现时同步增加 `AGENTS.md` 或 `.codex/skills/`，但本变更的最低要求是让模板内已有 AI 指引系统可以发现 UI 规范。

## Risks / Trade-offs

- [模板体积增大] → 通过排除 `node_modules/`、`dist/` 等构建产物，并只提交组件源码与必要配置来控制体积。
- [Agent 过度使用复杂组件] → 通过 `CLAUDE.md` 和 UI skill 明确基础组件优先、复杂组件按场景启用，并让默认示例只展示基础业务模式。
- [shadcn 依赖版本变化] → 组件源码与 `package-lock.json` 一起提交，实施时固定能构建的版本组合；后续升级作为独立维护任务处理。
- [Tailwind v4 与 shadcn 主题写法不一致] → 实施时以当前 shadcn Vite/Tailwind v4 指南为准，验证 `npm run build` 通过。
- [内置模板打包遗漏新增隐藏目录或配置] → 更新 CLI 内置模板测试或 init 流程测试，确保 `components.json`、`src/components/ui/`、UI skill 和 alias 配置能被复制到初始化项目。

## Migration Plan

1. 在 `init-repo/` 中引入 shadcn 配置、组件源码、依赖和主题变量。
2. 更新默认示例页面和 AI 指引文件。
3. 更新模板测试，验证安装、构建、组件文件存在、AI 指引存在。
4. 验证 CLI 内置模板打包后初始化的项目包含新增 UI 文件。

回滚方式是移除 shadcn 组件源码、依赖、配置和指引文件，并恢复旧版 `App.tsx` 与 CSS 入口。

## Open Questions

无。当前决策采用“全量组件预置 + 文档约束 + 默认示例克制展示”的方向。
