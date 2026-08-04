## 1. 收藏列表页和浏览历史页

- [x] 1.1 创建 `app/(dashboard)/my/favorites/page.tsx`：获取 `/api/me/favorites` 全部数据，展示列表（页面名称 + 相对时间），支持取消收藏（调用 `DELETE /api/favorites/:pagePath`），空状态提示"暂无收藏"
- [x] 1.2 创建 `app/(dashboard)/my/recent/page.tsx`：获取 `/api/me/recent` 全部数据，展示列表（页面路径 + 相对时间），点击跳转，空状态提示"暂无浏览记录"

## 2. 首页链接修复

- [x] 2.1 修复 `app/(dashboard)/page.tsx` 中 Favorites 的 `viewAllHref`：`/my/apps` → `/my/favorites`
- [x] 2.2 为首页 Recent 模块添加 `viewAllHref="/my/recent"`

## 3. 侧边栏入口

- [x] 3.1 在 `components/app-shell.tsx` 的 `profileNavItems` 中添加收藏（`/my/favorites`，Star 图标）和浏览历史（`/my/recent`，Clock 图标）

## 4. 隐藏 ThemeToggle

- [x] 4.1 移除 `app/layout.tsx` 中的 `<ThemeToggle />` 浮动按钮渲染（保留 ThemeProvider）

## 5. UI 文本中文化

- [x] 5.1 `components/app-shell.tsx`：sidebar 所有 label 改为中文（首页、个人资料、我的应用、API 密钥、我的群组、概览、数据分析、用户管理、应用管理、组织管理、系统配置）
- [x] 5.2 `app/(dashboard)/page.tsx`：首页文本中文（欢迎回来、工作区一览、我的应用、收藏、浏览历史、查看全部、暂无应用、暂无收藏、暂无浏览记录、加载中等）
- [x] 5.3 `components/shell/navbar.tsx`：navbar 文本中文（收藏、问题、登录、注册、退出）
- [x] 5.4 `app/(auth)/login/page.tsx`：登录页中文
- [x] 5.5 `app/(auth)/register/page.tsx`：注册页中文
- [x] 5.6 `app/(auth)/force-change-password/page.tsx`：强制改密页中文
- [x] 5.7 `app/(dashboard)/my/info/page.tsx`：个人资料页中文
- [x] 5.8 `app/(dashboard)/my/apps/page.tsx`：我的应用页中文
- [x] 5.9 `app/(dashboard)/my/keys/page.tsx`：API 密钥页中文
- [x] 5.10 `app/(dashboard)/my/groups/page.tsx`：群组页中文
- [x] 5.11 admin 页面中文：dashboard、analytics、users、pages、orgs、settings 六个页面
- [x] 5.12 `app/(dashboard)/my/page.tsx`：/my 重定向页无需改
- [x] 5.13 `components/shell/platform-shell.tsx` 和 `components/shell/issues-modal.tsx` 中文

## 6. 构建验证

- [x] 6.1 运行 `pnpm build` 确认构建成功
- [x] 6.2 用浏览器验证：侧边栏有收藏和历史入口，首页链接正确，UI 全中文
