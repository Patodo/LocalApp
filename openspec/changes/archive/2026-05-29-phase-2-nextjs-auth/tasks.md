## 1. Next.js 项目初始化

- [x] 1.1 在 `packages/web/` 创建 Next.js 项目（`npx create-next-app@latest` 或手动），配置 TypeScript
- [x] 1.2 安装依赖：`tailwindcss` v4、`@tailwindcss/postcss`、`lucide-react`、`next-themes`
- [x] 1.3 初始化 shadcn/ui (npx shadcn@latest init)，选择 Tailwind v4、CSS 变量、Zinc 色系
- [x] 1.4 添加 shadcn/ui 基础组件：`button`、`input`、`label`、`card`、`sonner`（toast）
- [x] 1.5 配置 `next.config.ts`：`output: "export"`、`basePath` 验证
- [x] 1.6 配置字体：`next/font` 加载 Geist Sans 和 Geist Mono
- [x] 1.7 配置 `next-themes` ThemeProvider，验证暗色/亮色切换 — **commit: "feat(web): scaffold Next.js app with Tailwind, shadcn/ui, dark mode"**

## 2. 认证页面实现

- [x] 2.1 实现登录页面 (`app/(auth)/login/page.tsx`) — 表单 UI、提交逻辑、错误处理、redirect 参数
- [x] 2.2 实现注册页面 (`app/(auth)/register/page.tsx`) — 表单 UI、客户端密码匹配验证、提交逻辑
- [x] 2.3 实现强制改密页面 (`app/(auth)/force-change-password/page.tsx`) — 表单 UI、提交逻辑
- [x] 2.4 实现首页重定向 (`app/page.tsx`) — 检测登录状态后 `router.push`
- [x] 2.5 验证每个页面在亮色和暗色模式下视觉效果正常 — **commit: "feat(web): implement auth pages - login, register, force-change-password"**

## 3. 服务器整合

- [x] 3.1 配置 Fastify 提供 `packages/web/out/` 静态文件服务（`@fastify/static`）
- [x] 3.2 修改 `serve.ts`，移除 `buildLoginPage()`、`buildRegisterPage()`、`buildForceChangePasswordPage()` 的路由注册
- [x] 3.3 确保 API 路由和 SPA fallback 正确协作（`/login` 返回 .html，`/api/auth/login` 由 Fastify 处理）
- [x] 3.4 确保旧 `/admin/*` 和 `/profile` 路由不受影响 — **commit: "feat(server): serve Next.js static exports for auth pages"**

## 4. 端到端验证

- [x] 4.1 构建 Next.js 应用 (`npm run build`)
- [x] 4.2 启动服务器，访问 `/login`，完成登录流程 — 验证 cookie 设置和 redirect
- [x] 4.3 访问 `/register`，注册新用户 — 验证注册成功
- [x] 4.4 访问 `/` — 验证根据登录状态正确重定向
- [x] 4.5 验证暗色/亮色主题切换 — **commit: "test: verify auth pages e2e with Next.js static export"**
