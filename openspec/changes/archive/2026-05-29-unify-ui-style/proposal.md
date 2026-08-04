## Why

LocalApp 平台的所有前端页面（登录/注册、Admin 管理面板、Profile 个人中心、应用外壳）视觉风格各异——登录页使用暗色主题，Admin 侧边栏暗色 + 内容区浅色混搭，Profile 全暗色，且三处分别维护独立的 CSS。端到端验证 Agent 功能时生成的 BUG Tracker 应用反而呈现出统一、清爽的浅色卡片风格。应以此风格为基准，统一所有平台内置前端页面的设计语言，消除视觉碎片化。

## What Changes

- 将登录、注册、强制改密三个服务器渲染页面的暗色主题（`#0f0f23` / `#1a1a2e`）替换为浅色主题（`#f8f9fa` / `#ffffff`），统一使用 BUG Tracker 设计 token
- 将应用外壳导航栏（`buildPlatformShell`）的暗色样式改为浅色，与新的页面风格一致
- 从 Admin SPA（`packages/admin`）和 Profile SPA（`packages/profile`）中移除 Tailwind CSS 依赖
- 创建共享 CSS 基础文件（`shared.css`），定义 design tokens 和通用组件样式
- 重写 Admin SPA 所有页面使用语义化 CSS class 替代 Tailwind utility class
- 重写 Profile SPA 所有页面使用语义化 CSS class 替代 Tailwind utility class
- 移除两个 SPA 包中的 `tailwindcss`、`postcss` 依赖和相关配置文件

## Capabilities

### New Capabilities

- `shared-design-system`: 定义全平台统一的 design tokens（颜色、间距、圆角、阴影、字体）、通用组件样式（按钮、表单、卡片、表格、标签）和布局模式，作为所有平台内置页面的视觉基础

### Modified Capabilities

- `user-profile-ui`: Profile SPA 页面从 Tailwind + 暗色主题迁移到手写 CSS + 浅色主题，视觉风格对齐 shared-design-system
- `admin-panel`: Admin SPA 页面从 Tailwind 迁移到手写 CSS，侧边栏改为浅色风格，视觉风格对齐 shared-design-system
- `admin-analytics-ui`: 运营大盘页面的图表卡片和表格样式迁移到手写 CSS
- `homepage-redirect`: 登录/注册/强制改密页面的内联 CSS 替换为浅色主题设计 token

## Impact

- **代码变更**:
  - `packages/server/src/routes/serve.ts` — 4 个 HTML 构建函数的 CSS 全部重写
  - `packages/admin/` — 所有 TSX 文件的 className 重写，新增/替换 CSS 文件，移除 Tailwind 配置
  - `packages/profile/` — 所有 TSX 文件的 className 重写，新增/替换 CSS 文件，移除 Tailwind 配置
  - 新增共享 CSS 文件（放置在 `packages/shared/styles/` 或独立目录）
- **依赖变更**: 移除 `tailwindcss`、`postcss` 依赖（admin + profile 各一套），移除 `postcss.config.js`、`tailwind.config.js`
- **无 API 变更**: 纯视觉层改造，不影响任何后端接口或数据结构
- **无破坏性变更**: 用户可见的视觉变化，但所有功能行为保持不变
