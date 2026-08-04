## 1. 创建共享 CSS 基础

- [x] 1.1 创建 `packages/shared/styles/shared.css`，包含 CSS minimal reset、`:root` design tokens、通用组件 class（`.btn`、`.form-input`、`.card`、`.table`、`.badge`、`.page-container` 等）
- [x] 1.2 验证 shared.css 的 token 值与 BUG Tracker 设计基准一致（颜色、圆角、阴影、字体）

## 2. 服务器渲染页面改造（Scope 1）

- [x] 2.1 重写 `buildLoginPage()` 的内联 CSS 为浅色主题，使用 shared.css token 值
- [x] 2.2 重写 `buildRegisterPage()` 的内联 CSS 为浅色主题，使用 shared.css token 值
- [x] 2.3 重写 `buildForceChangePasswordPage()` 的内联 CSS 为浅色主题，使用 shared.css token 值
- [x] 2.4 重写 `buildPlatformShell()` 的导航栏 CSS 为浅色主题，使用 shared.css token 值
- [x] 2.5 启动 server，浏览器验证登录、注册、强制改密、应用外壳页面的视觉效果

## 3. Profile SPA 改造（Scope 3）

- [x] 3.1 在 `packages/profile/src/main.tsx` 中引入 shared.css，替换 Tailwind 入口
- [x] 3.2 重写 `packages/profile/src/components/TabLayout.tsx` — 顶部栏和 tab 栏改为浅色主题，使用语义化 class
- [x] 3.3 重写 `packages/profile/src/pages/Profile.tsx` — 头像、表单、按钮改为 shared.css 组件 class
- [x] 3.4 重写 `packages/profile/src/pages/Apps.tsx` — 应用列表、删除确认改为 shared.css 组件 class
- [x] 3.5 重写 `packages/profile/src/pages/ApiKeys.tsx` — Key 列表、创建表单改为 shared.css 组件 class
- [x] 3.6 重写 `packages/profile/src/pages/Groups.tsx` — 分组 CRUD 改为 shared.css 组件 class
- [x] 3.7 移除 Profile 的 Tailwind 依赖：删除 `tailwind.config.js`、`postcss.config.js`，移除 `package.json` 中的 `tailwindcss` 和 `postcss` 依赖
- [x] 3.8 构建并浏览器验证 Profile SPA 所有页面（个人资料、我的应用、API Key、分组）

## 4. Admin SPA 改造（Scope 2）

- [x] 4.1 在 `packages/admin/src/main.tsx` 中引入 shared.css，替换 Tailwind 入口
- [x] 4.2 重写 `packages/admin/src/components/Layout.tsx` — 侧边栏改为浅色主题，使用语义化 class
- [x] 4.3 重写 `packages/admin/src/pages/Dashboard.tsx` — 统计卡片、部署表格改为 shared.css 组件 class
- [x] 4.4 重写 `packages/admin/src/pages/Users.tsx` — 用户表格、搜索、分页改为 shared.css 组件 class
- [x] 4.5 重写 `packages/admin/src/pages/Pages.tsx` — 页面表格改为 shared.css 组件 class
- [x] 4.6 重写 `packages/admin/src/pages/Groups.tsx` — 分组 CRUD 改为 shared.css 组件 class
- [x] 4.7 重写 `packages/admin/src/pages/Settings.tsx` — 配置展示改为 shared.css 组件 class
- [x] 4.8 重写 `packages/admin/src/pages/Analytics.tsx` — 图表卡片、时间范围按钮、Top 10 表格改为 shared.css 组件 class（Recharts 组件本身不变）
- [x] 4.9 移除 Admin 的 Tailwind 依赖：删除 `tailwind.config.js`、`postcss.config.js`，移除 `package.json` 中的 `tailwindcss` 和 `postcss` 依赖
- [x] 4.10 构建并浏览器验证 Admin SPA 所有页面（概览、运营大盘、用户、应用、分组、配置）

## 5. 部署与收尾

- [x] 5.1 运行 `npm run build` 确认所有包构建成功，无 CSS 引用错误
- [x] 5.2 启动 server，端到端验证所有页面视觉效果一致性
- [x] 5.3 将构建产物部署到 `packages/server/static/admin/` 和 `packages/server/static/profile/`
