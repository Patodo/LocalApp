## 1. Server 路由：新建 my-serve.ts

- [x] 1.1 创建 `packages/server/src/routes/my-serve.ts`，实现 `/my` 重定向到 `/my/info` 和 `/my/*` 通配路由（检查登录 → serveNextHtml）
- [x] 1.2 在 `/my/*` 路由中添加 admin 页面角色检查：dashboard、analytics、users、pages、orgs、settings 要求 admin 角色
- [x] 1.3 在 `packages/server/src/index.ts` 中注册 `myServeRoutes`，放在 `adminServeRoutes` 的位置（serve.ts 之前）
- [x] 1.4 删除 `packages/server/src/routes/admin-serve.ts`，移除 index.ts 中的 adminServeRoutes 导入和注册

## 2. Server 路由：404 HTML 渲染

- [x] 2.1 在 `serve.ts` 的 `/:userId/:name` 路由中，将 `readPageMeta` 返回 null 时的 JSON 404 改为 HTML 404 页面
- [x] 2.2 HTML 404 页面风格与登录页面一致（浅色主题），包含"返回首页"链接指向 `/`

## 3. Next.js 页面文件迁移

- [x] 3.1 将 `app/(dashboard)/admin/page.tsx` 内容迁移到 `app/(dashboard)/my/dashboard/page.tsx`（admin 概览页）
- [x] 3.2 将 `app/(dashboard)/admin/analytics/page.tsx` 迁移到 `app/(dashboard)/my/analytics/page.tsx`
- [x] 3.3 将 `app/(dashboard)/admin/users/page.tsx` 迁移到 `app/(dashboard)/my/users/page.tsx`
- [x] 3.4 将 `app/(dashboard)/admin/pages/page.tsx` 迁移到 `app/(dashboard)/my/pages/page.tsx`
- [x] 3.5 将 `app/(dashboard)/admin/groups/page.tsx` 迁移到 `app/(dashboard)/my/orgs/page.tsx`（路径从 groups 改为 orgs）
- [x] 3.6 将 `app/(dashboard)/admin/settings/page.tsx` 迁移到 `app/(dashboard)/my/settings/page.tsx`
- [x] 3.7 删除 `app/(dashboard)/admin/` 目录及所有子页面

## 4. Sidebar 和导航链接更新

- [x] 4.1 更新 `components/app-shell.tsx` 中 `adminNavItems` 的 href：`/admin/dashboard` → `/my/dashboard` 等
- [x] 4.2 更新 admin 页面组件中的内部导航链接（如有引用 `/admin/*` 的地方）

## 5. 构建验证

- [x] 5.1 运行 `pnpm -C packages/web build` 确认 Next.js 构建成功，`out/my/` 下生成新的 HTML 文件（dashboard.html、analytics.html 等）
- [x] 5.2 启动 dev server，验证 `/my/apps`、`/my/info` 返回 HTML 200
- [x] 5.3 验证 admin 用户访问 `/my/dashboard` 返回 HTML 200
- [x] 5.4 验证普通用户访问 `/my/dashboard` 被重定向到 `/`
- [x] 5.5 验证不存在的用户页面路径返回 HTML 404（非 JSON）
- [x] 5.6 验证 `/admin/*` 路径不再可用（被 `/:userId/:name` 当普通页面处理，返回 HTML 404）
