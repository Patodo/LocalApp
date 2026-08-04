## Why

Phase 2-4 完成了前端架构的统一（所有页面迁移到 Next.js），但视觉设计仍然沿用了旧的 `shared.css` 风格。在 [LocalApp 总体方案](../../../docs/plan.md) Phase 5 中，需要完成视觉层面的全面升级：暗色模式完善、响应式适配、shadcn/ui 主题定制、交互状态打磨。目标是达到 Linear/Vercel 级别的功能性简洁美学。

## What Changes

- shadcn/ui 主题完全定制（颜色、圆角、阴影、字体）
- 暗色模式在所有页面、所有组件中完善
- 响应式布局：侧边栏在平板及以下屏幕折叠为汉堡菜单；表格小屏横向滚动；卡片网格响应式断点
- 交互状态完善：
  - 骨架屏替代纯文字 loading 状态
  - Toast 通知替代部分 confirm 对话框
  - 过渡动画（侧边栏展开/折叠、模态框进出、页面切换）
- 数据展示多样化：Dashboard 不只有表格，引入卡片网格、时间线、迷你图表
- 空状态设计：图标 + 引导文案替代纯文字
- 旧 `shared.css` 归档（标记为 DEPRECATED，admin/profile package 归档后不再使用）
- 无障碍性：focus-visible 环、ARIA 标签、键盘导航

## Capabilities

### New Capabilities

- `dark-mode`: 完整的暗色模式系统，跟随系统偏好，支持手动切换
- `responsive-layout`: 响应式布局，支持桌面/平板/移动端

### Modified Capabilities

无。这是视觉层面改造，不改变功能行为。

## Impact

- 修改: `packages/web/` 中的大部分页面和组件（Tailwind 类调整、shadcn/ui 定制）
- 修改: `packages/web/app/globals.css`（CSS 变量覆盖）
- 修改: `packages/web/tailwind.config.ts` 或等效的 Tailwind v4 配置
- 修改: `packages/web/components/` 中的所有组件
- 归档: `packages/shared/styles/shared.css`（加 DEPRECATED 标记）
- 不影响: API、数据库、CLI、SDK
