## 1. 项目脚手架

- [x] 1.1 创建 `packages/admin/` 目录，初始化 Vite + React + TypeScript 项目（package.json、tsconfig、vite.config）
- [x] 1.2 安装依赖：react-router-dom、tailwindcss（dev）
- [x] 1.3 配置 Tailwind CSS（tailwind.config、postcss.config、全局样式入口）
- [x] 1.4 配置 Vite 构建输出到 `../../packages/server/static/admin/`（或自定义输出目录）
- [x] 1.5 root `pnpm-workspace.yaml` 新增 `packages/admin`

## 2. API 调用层

- [x] 2.1 创建 `src/api/admin.ts`：封装 fetch 调用 `/api/admin/*` 端点（stats、users、pages），统一错误处理

## 3. 布局与路由

- [x] 3.1 创建 `src/components/Layout.tsx`：左侧导航 + 顶部栏 + 内容区
- [x] 3.2 创建 `src/App.tsx`：React Router 配置（`/admin`、`/admin/users`、`/admin/pages`、`/admin/settings`）
- [x] 3.3 创建 `src/main.tsx` 入口

## 4. 页面组件

- [x] 4.1 `src/pages/Dashboard.tsx`：概览卡片（用户数、页面数、存储量）+ 最近部署列表
- [x] 4.2 `src/pages/Users.tsx`：用户表格（分页、删除按钮 + 确认对话框）
- [x] 4.3 `src/pages/Pages.tsx`：全局页面表格（分页、用户过滤、删除）
- [x] 4.4 `src/pages/Settings.tsx`：系统配置只读展示

## 5. 服务端路由

- [x] 5.1 新建 `packages/server/src/routes/admin-serve.ts`：`GET /admin` 返回面板 HTML（含 admin 角色校验）
- [x] 5.2 `GET /admin/assets/*` 返回构建产物静态文件
- [x] 5.3 非 admin 访问 `/admin` 返回 302 重定向到 `/login?redirect=/admin`
- [x] 5.4 `packages/server/src/index.ts` 在 serve 路由之前注册 admin-serve 路由（确保优先匹配）

## 6. 构建集成

- [x] 6.1 npm script：`packages/admin` 的 build 输出到 `packages/server/static/admin/`
- [x] 6.2 root `package.json` 添加 `build:admin` script
- [x] 6.3 `.gitignore` 忽略 `packages/server/static/admin/`（构建产物不入库）

## 7. e2e 测试

- [x] 7.1 `tests/e2e/admin-serve.test.ts`：测试 `/admin` 路由的访问控制（未登录重定向、普通用户 403、admin 200）
- [x] 7.2 测试 `/admin/assets/*` 静态文件服务

## 8. 收尾

- [x] 8.1 手动验证面板完整流程（登录 → 查看概览 → 用户管理 → 应用管理）
- [x] 8.2 提交所有变更
