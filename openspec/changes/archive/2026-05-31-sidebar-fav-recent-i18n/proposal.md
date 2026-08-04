## Why

首页的 Favorites "查看全部" 错误链接到 `/my/apps`，Recent 模块没有"查看全部"链接；侧边栏缺少收藏和浏览历史的独立入口，用户无法便捷访问这些功能。同时 ThemeToggle 浮动按钮当前阶段需隐藏，且整个 UI 使用英文但用户群体为中文。

## What Changes

- 修复首页 Favorites 的 "View all" 链接：`/my/apps` → `/my/favorites`
- 首页 Recent 模块增加 "View all" 链接指向 `/my/recent`
- 新建 `/my/favorites` 独立列表页：展示全部收藏，支持取消收藏操作
- 新建 `/my/recent` 独立列表页：展示全部浏览历史
- 侧边栏 `profileNavItems` 添加 Favorites 和 Recent 入口
- 隐藏 ThemeToggle 浮动按钮（移除 layout.tsx 中的渲染，保留 ThemeProvider）
- 全 UI 文本从英文硬编码替换为中文硬编码（不引入 i18n 框架）

## Capabilities

### New Capabilities
- `favorites-page`: 收藏列表独立页面，展示用户全部收藏并支持取消收藏
- `recent-page`: 浏览历史独立页面，展示用户全部最近访问记录

### Modified Capabilities
- `user-dashboard-ui`: sidebar 添加收藏和历史入口，首页修复/增加"查看全部"链接
- `homepage-redirect`: 全 UI 文本中文化

## Impact

- **Web**: `app/(dashboard)/page.tsx` 修复链接；新增 `my/favorites/page.tsx` 和 `my/recent/page.tsx`
- **Web**: `components/app-shell.tsx` sidebar 添加两个导航项
- **Web**: `app/layout.tsx` 移除 ThemeToggle 浮动按钮
- **Web**: 所有 `.tsx` 文件中的英文文本替换为中文
- **Server**: `/api/me/favorites` 和 `/api/me/recent` 已有（支持 `limit` 参数），无需新增后端接口
