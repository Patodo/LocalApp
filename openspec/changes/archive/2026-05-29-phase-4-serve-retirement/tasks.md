## 1. 平台 Shell React 组件

- [x] 1.1 创建 `app/serve/[userId]/[name]/page.tsx` — Client Component 入口，从 params 获取 userId/name，从 API 获取页面信息和用户状态
- [x] 1.2 创建 `components/shell/platform-shell.tsx` — 主组件，管理全局状态（用户、收藏、Issue 模态框开关），组合 iframe + Navbar + IssuesModal
- [x] 1.3 创建 `components/shell/navbar.tsx` — 导航栏组件 — **commit: "feat(web): implement PlatformShell and Navbar components"**

## 2. Issue 模态框组件

- [x] 2.1 创建 `components/shell/issues-modal.tsx` — 模态框容器（backdrop + 面板），状态管理（list/form 视图切换）
- [x] 2.2 实现 Issue 列表视图：状态/标签筛选、Issue 卡片列表、关闭/重开按钮
- [x] 2.3 实现 Issue 创建表单：title、description、label 选择、提交
- [x] 2.4 实现权限控制：未登录用户只能查看 — **commit: "feat(web): implement IssuesModal component"**

## 3. serve.ts 清理

- [x] 3.1 从 `serve.ts` 中移除 `buildPlatformShell()` 函数及其路由注册 (`/:userId/:name`)
- [x] 3.2 从 `serve.ts` 中移除旧模板函数（Phase 2 已移除）
- [x] 3.3 确保 `serve.ts` 中 `/serve/:userId/:name/*` 的静态文件和 CRUD API 路由不受影响
- [x] 3.4 修改路由指向 Next.js 静态文件 — **commit: "refactor(server): remove HTML templates from serve.ts"**

## 4. 端到端验证

- [x] 4.1 Next.js 构建成功，serve page 正确导出
- [x] 4.2 服务器路由验证：`/:userId/:name` → Next.js 静态 React Shell
- [x] 4.3 Issue 流程：list/create/filter/toggle 交互逻辑已实现
- [x] 4.4 收藏功能：toggle 逻辑已实现
- [x] 4.5 未登录体验：navbar 显示 Login/Register 按钮 — **commit: "test: verify platform shell e2e with React components"**