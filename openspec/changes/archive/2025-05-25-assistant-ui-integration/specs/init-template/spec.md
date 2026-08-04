## MODIFIED Requirements

### Requirement: 模板依赖配置

模板的 `package.json` SHALL 声明 `react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`typescript` 作为开发依赖，`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 作为运行时依赖。此外 SHALL 声明 `@assistant-ui/react` 作为运行时依赖，`tailwindcss` 和 `@tailwindcss/postcss` 作为开发依赖。不依赖 `@localapp/client` npm 包（SDK 以源码形式内嵌）。

#### Scenario: 安装依赖
- **WHEN** 在 `init-repo/` 目录执行 `npm install`
- **THEN** 成功安装 react、react-dom、vite、@assistant-ui/react、tailwindcss 等依赖，无报错

#### Scenario: 构建项目
- **WHEN** 在 `init-repo/` 目录执行 `npm run build`
- **THEN** 生成 `dist/` 目录，包含可运行的 `index.html`，Tailwind CSS 被正确编译

## ADDED Requirements

### Requirement: PostCSS 配置

模板 SHALL 包含 `postcss.config.js`，配置 `@tailwindcss/postcss` 插件。

#### Scenario: PostCSS 配置文件存在且正确
- **WHEN** 查看 `init-repo/postcss.config.js`
- **THEN** 文件导出包含 `@tailwindcss/postcss` 插件的对象

#### Scenario: Vite 自动使用 PostCSS
- **WHEN** 执行 `npm run build` 或 `npm run dev`
- **THEN** Vite 自动检测 postcss.config.js 并处理 CSS，无需额外 Vite 插件配置

### Requirement: Tailwind CSS 入口文件

模板 SHALL 包含 `src/index.css` 文件，内容为 `@import "tailwindcss";`。`src/main.tsx` SHALL 导入该 CSS 文件。

#### Scenario: index.css 存在
- **WHEN** 查看 `init-repo/src/index.css`
- **THEN** 文件包含 `@import "tailwindcss";`

#### Scenario: main.tsx 导入 CSS
- **WHEN** 查看 `init-repo/src/main.tsx`
- **THEN** 文件顶部包含 `import "./index.css";`

### Requirement: assistant-ui 消息格式适配器

`src/lib/localapp/agent/assistant-ui-adapter.ts` SHALL 导出 `convertMessages` 函数，将 pi-agent-core 的 `AgentMessage[]` 转换为 assistant-ui 的 `ThreadMessageLike[]`。

#### Scenario: 适配器文件存在且导出正确
- **WHEN** 从 `./lib/localapp/agent/assistant-ui-adapter` 导入 `convertMessages`
- **THEN** 函数接受 `AgentMessage[]` 参数，返回 `ThreadMessageLike[]`
