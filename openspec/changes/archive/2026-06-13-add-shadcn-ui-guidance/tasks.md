## 1. RED：补充失败测试

- [x] 1.1 为 `init-repo/` 增加模板结构测试，断言 `components.json`、`src/lib/utils.ts`、`src/components/ui/` 和关键 shadcn 组件文件存在
- [x] 1.2 为 `init-repo/` 增加配置测试，断言 `tsconfig.json` 和 `vite.config.ts` 配置 `@/*` alias，`src/index.css` 保留 Tailwind 入口并包含 shadcn 主题变量
- [x] 1.3 为 `init-repo/` 增加 AI 指引测试，断言 `CLAUDE.md` 引用 UI skill，且 `.claude/skills/` 包含 shadcn/ui 使用约束文件
- [x] 1.4 为默认示例页增加测试，断言 `App.tsx` 使用 LocalApp SDK Hook 和 shadcn 基础组件，且不是组件陈列页
- [x] 1.5 为 CLI 内置模板增加测试，断言内置模板解压后包含 shadcn 配置、组件目录和 UI 指引文件
- [x] 1.6 运行相关测试，确认新增测试在实现前失败
- [x] 1.7 提交 RED 阶段变更，commit message 使用中文 Conventional Commits

## 2. GREEN：实现 shadcn 全量组件与项目配置

- [x] 2.1 在 `init-repo/package.json` 和 lockfile 中加入 shadcn 全量组件所需依赖，确保 `npm install` 可复现
- [x] 2.2 添加 `init-repo/components.json`，配置组件目录、工具函数路径、CSS 入口和 `@/*` aliases
- [x] 2.3 添加 `init-repo/src/lib/utils.ts`，导出 `cn()` className 合并工具
- [x] 2.4 更新 `init-repo/tsconfig.json`，加入 `baseUrl` 和 `paths` 配置
- [x] 2.5 更新 `init-repo/vite.config.ts`，加入 `resolve.alias`，并保持现有 dev proxy 行为不变
- [x] 2.6 更新 `init-repo/src/index.css`，加入 shadcn 主题变量、暗色模式变量和基础层样式，同时保留 Tailwind v4 入口
- [x] 2.7 将 shadcn/ui 全量组件源码加入 `init-repo/src/components/ui/`
- [x] 2.8 运行 `init-repo` 相关测试和 `npm run build`，确认 GREEN 阶段通过
- [x] 2.9 提交 GREEN 阶段变更，commit message 使用中文 Conventional Commits

## 3. GREEN：实现文件引导与默认示例

- [x] 3.1 新增 `.claude/skills/` 下的 shadcn/ui 或 UI 组件开发指引文件，说明全量组件可用、基础组件优先和复杂组件使用边界
- [x] 3.2 更新 `init-repo/CLAUDE.md`，在深入指南中加入 UI skill 入口，并补充 shadcn 组件导入约定
- [x] 3.3 更新 `init-repo/src/App.tsx`，使用 shadcn 基础组件展示当前用户、列表、创建表单、加载状态、错误状态和空状态
- [x] 3.4 确保示例页的所有表单控件都有 `label` 与 `htmlFor`/`id` 关联
- [x] 3.5 运行 `init-repo` 相关测试和 `npm run build`，确认默认示例可构建
- [x] 3.6 提交第二个 GREEN 阶段变更，commit message 使用中文 Conventional Commits

## 4. REFACTOR：整理模板与内置打包验证

- [x] 4.1 检查 shadcn 组件、示例页和 AI 指引中的导入路径，统一使用 `@/components/ui/*` 和 `@/lib/utils`
- [x] 4.2 检查模板文件体积和 `.gitignore`，确保不引入 `node_modules/`、`dist/` 或 shadcn CLI 临时文件
- [x] 4.3 运行 CLI 内置模板解压测试，确认新增隐藏目录和 UI 文件不会被遗漏
- [x] 4.4 在临时目录使用内置模板初始化项目，执行 `npm install` 和 `npm run build`
- [x] 4.5 根据测试反馈整理实现，不改变已通过的对外契约
- [x] 4.6 提交 REFACTOR 阶段变更，commit message 使用中文 Conventional Commits

## 5. 验证与收尾

- [x] 5.1 运行 `openspec validate add-shadcn-ui-guidance --strict`
- [x] 5.2 运行项目中与 init 模板、CLI 内置模板相关的测试套件
- [x] 5.3 记录最终验证命令和结果，确认所有新增需求均有测试覆盖
