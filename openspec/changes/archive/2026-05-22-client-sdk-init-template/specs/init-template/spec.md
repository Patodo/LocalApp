## ADDED Requirements

### Requirement: 模板目录结构

`init-repo/` SHALL 为独立的 Vite + React 项目模板目录，包含完整的可运行项目骨架。模板不属于 pnpm workspace。

#### Scenario: 模板目录验证
- **WHEN** 查看 `init-repo/` 目录
- **THEN** 包含 `package.json`、`vite.config.ts`、`index.html`、`tsconfig.json`、`CLAUDE.md`、`src/main.tsx`、`src/App.tsx`、`src/lib/localapp/`（SDK 源码）

#### Scenario: 模板不在 pnpm workspace 中
- **WHEN** 查看 `pnpm-workspace.yaml`
- **THEN** 不包含 `init-repo` 目录

### Requirement: 模板依赖配置

模板的 `package.json` SHALL 声明 `react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`typescript` 作为开发依赖。不依赖 `@localapp/client` npm 包（SDK 以源码形式内嵌）。

#### Scenario: 安装依赖
- **WHEN** 在 `init-repo/` 目录执行 `npm install`
- **THEN** 成功安装 react、react-dom、vite 等依赖，无报错

#### Scenario: 构建项目
- **WHEN** 在 `init-repo/` 目录执行 `npm run build`
- **THEN** 生成 `dist/` 目录，包含可运行的 `index.html`

### Requirement: SDK 源码预装

模板的 `src/lib/localapp/` 目录 SHALL 包含完整的 SDK 源码（`client.ts`、`react.ts`、`index.ts`、`types.ts`），通过 `pnpm sync:sdk` 从 `packages/client/src/` 同步。

#### Scenario: SDK 源码可用
- **WHEN** 在模板的 `App.tsx` 中 import `{ useList, useMe }` from `'./lib/localapp'`
- **THEN** TypeScript 编译通过，Vite 构建成功

### Requirement: 示例页面

模板 SHALL 包含一个示例 `App.tsx`，展示 SDK 的基本用法：查询访客身份、列表展示、创建记录。

#### Scenario: 示例页面包含 SDK 调用
- **WHEN** 查看 `init-repo/src/App.tsx`
- **THEN** 代码中使用 `useMe`、`useList`、`useCreate` 等 Hook，包含完整的 JSX 渲染逻辑

#### Scenario: 示例页面可构建
- **WHEN** 执行 `npm run build`
- **THEN** 示例页面成功构建为 `dist/index.html`，无编译错误

### Requirement: CLAUDE.md AI 助手指南

模板 SHALL 包含 `CLAUDE.md` 文件，面向 AI 助手说明平台能力和 SDK 用法。内容 SHALL 包含：平台能力概述、SDK Hook 参考文档、CLI 命令参考、常见开发模式示例。

#### Scenario: CLAUDE.md 包含 Hook 文档
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含每个 Hook 的签名、参数说明和示例代码

#### Scenario: CLAUDE.md 包含 CLI 命令
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含 `localapp schemas create`、`localapp upload` 等常用命令说明

#### Scenario: CLAUDE.md 包含访问控制说明
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档说明页面级和路由级访问控制的配置方法
