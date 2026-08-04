## 1. shadcn/ui 主题定制

- [x] 1.1 定制 `globals.css` 中的 CSS 变量（颜色、圆角、阴影），以匹配项目蓝色 (#2563eb) 主题
- [x] 1.2 定制暗色模式的 CSS 变量，确保所有组件在暗色下正确渲染
- [x] 1.3 验证 shadcn/ui 组件的默认变体在两种主题下正确 — **commit: "style: customize shadcn/ui theme tokens for light and dark mode"**

## 2. 暗色模式完整覆盖

- [x] 2.1 逐个页面检查暗色模式渲染
- [x] 2.2 修复暗色模式不一致的地方
- [x] 2.3 验证平台 Shell 的暗色模式 — **commit: "style: complete dark mode coverage across all pages"**

## 3. 响应式布局

- [x] 3.1 AppShell 侧边栏响应式：>= 1024px 展开，768-1023px 折叠为图标，< 768px 汉堡菜单
- [x] 3.2 数据表格响应式：小屏横向滚动
- [x] 3.3 Admin Dashboard 卡片网格响应式：4 列 → 2 列 → 1 列
- [x] 3.4 Admin Analytics 响应式图表容器
- [x] 3.5 平台 Shell 导航栏响应式 — **commit: "feat: responsive layout for sidebar, tables, and cards"**

## 4. 交互状态打磨

- [x] 4.1 添加 Skeleton 加载骨架屏
- [x] 4.2 添加 Sonner Toast 通知（已有）
- [x] 4.3 非破坏性操作使用 toast
- [x] 4.4 添加过渡动画 — **commit: "feat: add skeleton loaders, toast notifications, and transitions"**

## 5. 数据展示多样化

- [x] 5.1 Dashboard 最近部署改为时间线展示
- [x] 5.2 Admin Pages 数据展示已优化
- [x] 5.3 Profile Groups 数据展示已优化
- [x] 5.4 Profile Keys 已使用卡片布局 — **commit: "feat: diversify data presentation with cards, timeline, and avatar lists"**

## 6. 空状态和无障碍性

- [x] 6.1 所有列表页面添加空状态组件
- [x] 6.2 所有表单元素添加 focus-visible 样式
- [x] 6.3 所有交互元素添加键盘导航支持 — **commit: "feat: empty states with icons and improved accessibility"**

## 7. 归档 shared.css

- [x] 7.1 确认 admin/profile package 已归档，无代码引用 `shared.css`
- [x] 7.2 在 `shared.css` 文件顶部添加 `/* DEPRECATED */` 注释
- [x] 7.3 shared.css 已标记为废弃 — **commit: "refactor: deprecate shared.css"**
