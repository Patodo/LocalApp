## MODIFIED Requirements

### Requirement: 模板依赖配置

模板的 `package.json` SHALL 声明 `react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`typescript` 作为开发依赖，`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 作为运行时依赖。此外 SHALL 声明 `@assistant-ui/react` 作为运行时依赖，`tailwindcss` 和 `@tailwindcss/postcss` 作为开发依赖。不依赖任何外部 SDK npm 包。

模板的 `vite.config.ts` SHALL 设置 `base: "./"`，确保构建产物使用相对路径，在平台任意层级路径下均可正确加载资源。

#### Scenario: 安装依赖
- **WHEN** 在 `init-repo/` 目录执行 `npm install`
- **THEN** 成功安装所有依赖，无报错

#### Scenario: 构建项目
- **WHEN** 在 `init-repo/` 目录执行 `npm run build`
- **THEN** 生成 `dist/` 目录，包含可运行的 `index.html`，Tailwind CSS 被正确编译，资源引用为相对路径（`./assets/...`）

#### Scenario: 相对路径构建
- **WHEN** 查看 `npm run build` 生成的 `dist/index.html`
- **THEN** `<script>` 和 `<link>` 标签的 src/href 使用 `./assets/...` 格式的相对路径

## ADDED Requirements

### Requirement: ESM import 约定文档

模板的 `CLAUDE.md` SHALL 在 SDK 导入示例中显式标注 `.js` 扩展名要求，确保开发者了解 TypeScript + ESM 环境下的导入规范。

#### Scenario: CLAUDE.md 包含导入约定
- **WHEN** 查看 `init-repo/CLAUDE.md` 的 SDK 参考章节
- **THEN** 所有 `import {...} from "./lib/localapp"` 示例包含 `.js` 扩展名，且第一段有说明"TypeScript 导入 SDK 必须使用完整的 `.js` 扩展名路径"

### Requirement: useAgent 闭包模式文档

模板的 Agent 工具编写 skill（`.claude/skills/agent-tool-patterns/SKILL.md`）SHALL 解释 `useAgent` 的 `optionsRef.current` 间接引用模式及其目的，消除开发者对工具函数闭包过期的顾虑。

#### Scenario: Skill 包含闭包说明
- **WHEN** 查看 `.claude/skills/agent-tool-patterns/SKILL.md`
- **THEN** 包含说明章节解释工具函数通过 `optionsRef.current` 延迟引用，每次重渲染自动获取最新闭包，无需手动 useCallback

### Requirement: useMe 错误处理文档修正

模板的 `CLAUDE.md` 中 useMe 的错误处理示例 SHALL 不再展示 `error.status === 401` 的检查方式，SHALL 改为直接检查 `me === null` 判断是否登录。`/api/me` 在未登录时返回 `{ success: true, data: null }`，不会触发 401。

#### Scenario: CLAUDE.md 中 useMe 示例正确
- **WHEN** 查看 `init-repo/CLAUDE.md` 中 useMe 的错误处理章节
- **THEN** 示例代码不使用 `error.status === 401` 检查 me，而是检查 `me === null` 或 `!me`，未登录时用 `redirectToLogin()` 引导登录
