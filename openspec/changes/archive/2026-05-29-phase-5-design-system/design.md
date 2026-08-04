## Context

Phase 2-4 完成了前端架构的统一。此时所有平台页面都在一个 Next.js 应用中，使用 Tailwind + shadcn/ui。但：

- shadcn/ui 仍使用默认的 Zinc 主题变量
- 暗色模式在部分页面可能不完全
- 移动端体验未优化
- 加载、空状态、错误状态是纯文字
- 数据展示以表格为主，缺乏多样性

Phase 5 的目标是在这个统一的基础上完成视觉打磨。

本变更是 [LocalApp 总体方案](../../../docs/plan.md) Phase 5 的实施内容。Phase 1-4 已完成 SDK 包、Next.js 应用、所有页面迁移、serve.ts 退役。

## Goals / Non-Goals

**Goals:**
- 统一的视觉语言（颜色、圆角、阴影、间距、字体）
- 所有页面暗色模式完美运行
- 桌面/平板/移动端都可使用
- 交互有反馈（loading → skeleton, success → toast, action → transition）
- 数据展示多样化（不只表格）

**Non-Goals:**
- 不改变信息架构（URL、导航结构不变）
- 不引入复杂动画（不动 Motion/GSAP，仅 CSS transition）；这是管理面板不是营销站
- 不更换数据获取策略（保留 useEffect + fetch 模式）
- 不影响主题色（蓝色 `#2563eb` 保留）
- 不改变任何 API

## Decisions

### Decision 1: 主题定制方式

**选择：** shadcn/ui CSS 变量覆盖 + Tailwind 配置

在 `globals.css` 中覆盖 shadcn/ui 的 CSS 变量：

```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --primary: 221 83% 53%;         /* #2563eb */
  --primary-foreground: 0 0% 100%;
  --radius: 0.5rem;               /* 8px → 保持和 shared.css 一致 */
}
.dark {
  --background: 240 10% 3.9%;     /* zinc-950 */
  --foreground: 0 0% 98%;
  --primary: 217 91% 60%;         /* 暗色下稍微提亮 */
  --primary-foreground: 0 0% 100%;
}
```

**理由：** shadcn/ui 的设计就是通过 CSS 变量覆盖来定制，无需修改组件源码。

### Decision 2: 响应式断点

**选择：** Tailwind 默认断点 + 以下规则：

- **桌面 (>= 1024px)**: 侧边栏展开（240px）、表格全宽、卡片网格 3-4 列
- **平板 (768-1023px)**: 侧边栏折叠为图标模式（56px）、卡片网格 2 列
- **移动 (< 768px)**: 隐藏侧边栏、汉堡菜单、表格横向滚动、卡片网格 1 列

**理由：** 对标 Linear 和 Vercel 的管理面板，它们在平板上通常折叠侧边栏，手机上完全隐藏。

### Decision 3: 骨架屏实现

**选择：** 简单的 CSS 动画骨架屏，不需要额外的库。表格加载时显示 5 行占位行，卡片加载时显示等大的灰色矩形。

**理由：** 管理面板的加载场景相对简单（表格/卡片加载），shadcn/ui 的 Skeleton 组件已足够。

### Decision 4: Toast 通知

**选择：** 使用 shadcn/ui 的 Sonner（`next-sonner`）。操作成功用绿色 toast，失败用红色 toast。

替换的 confirm 对话框场景：
- 非破坏性操作的成功反馈（如 "保存成功"）→ 改用 toast
- 破坏性操作（删除）→ 保留 confirm 对话框

**理由：** Toast 更轻量，不打断用户操作。删除等破坏性操作需要二次确认。

### Decision 5: 数据展示多样化

**选择：** 不同数据使用不同视觉格式：

| 数据类型 | 当前 | 目标 |
|---------|------|------|
| 统计概览 | 4 个 stat-card | 4 个 stat-card (保持，略调整) |
| 最近部署 | 表格 | 时间线 + 关键信息 |
| 用户列表 | 表格 | 表格 (保持，这是正确格式) |
| 应用列表 | 表格 | 卡片网格 + 快捷操作 |
| 分组详情 | 表格 + 表单 | 卡片 + 成员头像列表 |
| API Keys | 表格 | 卡片 + 复制按钮 |

**理由：** 管理面板不全是表格。卡片提供更好的信息层次。

## Risks / Trade-offs

- **过度设计风险** → 始终记住这是管理面板，不是营销网站。不引入 Motion/GSAP/Three.js。动画限制在 CSS transition
- **响应式测试成本** → 使用 Chrome DevTools 设备模拟覆盖主要断点
- **旧 shared.css 依赖** → 确认 admin/profile package 归档后无其他引用再彻底移除
