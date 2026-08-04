## 1. 后端：favorites 数据表与 API

- [x] 1.1 在 `meta-sqlite.ts` 中创建 `favorites` 表（id, user_id, page_path, page_name, owner_name, created_at）和唯一约束 + user_id 索引
- [x] 1.2 在 `meta-sqlite.ts` 中添加 favorites CRUD 函数：addFavorite、removeFavorite、isFavorited、getFavoriteCount、listUserFavorites
- [x] 1.3 创建 `packages/server/src/routes/favorites.ts`，实现 4 个 API 路由：POST /api/favorites、DELETE /api/favorites/:pagePath、GET /api/favorites/check、GET /api/favorites/count
- [x] 1.4 在 favorites 路由中添加 GET /api/me/favorites?limit=N 端点（session auth，返回当前用户收藏列表）
- [x] 1.5 在 server/index.ts 中注册 favorites 路由
- [x] 1.6 编写 favorites API 单元测试，验证添加/删除/检查/计数/列表/幂等/未登录401

## 2. 后端：page_views 加 user_id + 最近访问 API

- [x] 2.1 在 `meta-sqlite.ts` 初始化中为 `page_views` 表添加 `user_id TEXT` 列（ALTER TABLE 兼容已有数据库）
- [x] 2.2 为 `page_views` 添加 `idx_page_views_user` 索引
- [x] 2.3 更新 `PageViewEntry` 接口添加 `userId` 字段，更新 `insertPageViews` 函数写入 `user_id`
- [x] 2.4 在 `meta-sqlite.ts` 中添加 `listRecentVisits(userId, limit)` 函数（按 user_id 查询，去重取最新）
- [x] 2.5 在 serve.ts 中更新 `pushPageView` 调用，传递 `req.userId`（从 session 获取）
- [x] 2.6 在 serve 路由或新路由文件中添加 GET /api/me/recent?limit=N 端点
- [x] 2.7 编写最近访问 API 测试，验证去重、排序、空结果

## 3. 后端：补全 /api/me/pages 系列端点

- [x] 3.1 在 pages 路由中添加 GET /api/me/pages（session auth，返回当前用户的应用列表）
- [x] 3.2 添加 GET /api/me/pages/:name（session auth，返回应用详情）
- [x] 3.3 添加 DELETE /api/me/pages/:name（session auth，删除应用）
- [x] 3.4 添加 GET /api/pages/:userId/:name/meta（公开，返回页面元信息供 platform-shell 使用）
- [x] 3.5 编写 /api/me/pages 端点测试

## 4. 前端：路由重组 /profile/* → /my/*

- [x] 4.1 将 `packages/web/app/(dashboard)/profile/` 目录重命名为 `my/`
- [x] 4.2 更新 `app-shell.tsx` 中 `profileNavItems` 的 href 从 `/profile/*` 改为 `/my/*`
- [x] 4.3 更新所有内部链接：login 页面 redirect、logout redirect、navbar 头像链接、sidebar Profile 按钮
- [x] 4.4 更新 `platform-shell.tsx` 中的收藏跳转链接（redirect 参数）
- [x] 4.5 验证 Next.js 构建通过（`pnpm -C packages/web build`）

## 5. 前端：侧边栏加入 Home 入口

- [x] 5.1 在 `app-shell.tsx` 中添加 Home 导航项（House 图标，href="/"），固定在侧边栏顶部
- [x] 5.2 修改侧边栏逻辑：Home 始终显示，下方按条件显示 my 区域或 admin 区域（admin 用户显示两个区域）
- [x] 5.3 更新 logout redirect 路径

## 6. 前端：serve 页 navbar 加入 Home 按钮

- [x] 6.1 在 `navbar.tsx` 中 App Name 左侧添加 Home 按钮（House 图标，链接到 `/`）
- [x] 6.2 更新 navbar 布局确保 Home 按钮固定在左上角不受应用名称长度影响

## 7. 前端：HOME 主页实现

- [x] 7.1 将 `packages/web/app/page.tsx` 从重定向改为渲染首页组件
- [x] 7.2 创建首页组件，包含三模块布局框架（我的应用、收藏应用、最近访问）
- [x] 7.3 实现"我的应用"模块：调用 GET /api/me/pages?limit=8，卡片网格展示，空状态
- [x] 7.4 实现"收藏应用"模块：调用 GET /api/me/favorites?limit=5，列表展示，空状态
- [x] 7.5 实现"最近访问"模块：调用 GET /api/me/recent?limit=5，列表展示，空状态
- [x] 7.6 每个模块独立 loading 状态和错误处理
- [x] 7.7 未登录用户重定向到 `/login?redirect=/`

## 8. 集成验证

- [x] 8.1 启动 dev server，登录后访问 `/`，验证三模块数据正确显示
- [x] 8.2 验证侧边栏 Home 入口功能正常，admin 用户看到两个区域
- [x] 8.3 访问 serve 页面，验证 navbar Home 按钮跳转到 `/`
- [x] 8.4 验证收藏流程：在 serve 页收藏应用 → 首页收藏模块显示
- [x] 8.5 验证最近访问：访问多个应用 → 首页最近访问模块显示（去重 + 倒序）
- [x] 8.6 验证 `/my/*` 路由正常工作，旧 `/profile/*` 返回 404
