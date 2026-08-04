## MODIFIED Requirements

### Requirement: SDK 源码预装

模板的 `src/lib/localapp/` 目录 SHALL 包含完整的 SDK 源码（`client.ts`、`react.ts`、`index.ts`、`types.ts`）。SDK 源码 SHALL 直接在 `init-repo/` 中维护，不依赖 `packages/client/` 或 `sync:sdk` 脚本。`agent/context.ts` SHALL 导出 `buildSystemPrompt` 函数，接受三个参数：`systemContext`（系统层上下文）、`schemaContext`（数据层上下文）、`hint`（应用层提示）。`client.ts` SHALL 导出 `detectBasePath` 函数。

#### Scenario: SDK 源码可用
- **WHEN** 在模板的 `App.tsx` 中 import `{ useList, useMe }` from `'./lib/localapp'`
- **THEN** TypeScript 编译通过，Vite 构建成功

#### Scenario: buildSystemPrompt 三参数接口
- **WHEN** 从 `./lib/localapp/agent/context` 导入 `buildSystemPrompt`
- **THEN** 函数签名为 `(systemContext: string, schemaContext: string, hint?: string) => string`

#### Scenario: detectBasePath 导出
- **WHEN** 从 `./lib/localapp` 导入 `detectBasePath`
- **THEN** 它是一个无参数函数，返回当前页面的 API basePath 字符串

### Requirement: 模板依赖配置

模板的 `package.json` SHALL 声明 `react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`typescript` 作为开发依赖，`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 作为运行时依赖。此外 SHALL 声明 `@assistant-ui/react` 作为运行时依赖，`tailwindcss` 和 `@tailwindcss/postcss` 作为开发依赖。不依赖任何外部 SDK npm 包。

#### Scenario: 安装依赖
- **WHEN** 在 `init-repo/` 目录执行 `npm install`
- **THEN** 成功安装所有依赖，无报错

#### Scenario: 构建项目
- **WHEN** 在 `init-repo/` 目录执行 `npm run build`
- **THEN** 生成 `dist/` 目录，包含可运行的 `index.html`，Tailwind CSS 被正确编译
