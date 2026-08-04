# dark-mode

## Purpose

[TBD] 定义暗色模式的视觉规范和组件适配要求，确保所有页面和组件在暗色主题下正确渲染，满足 WCAG AA 对比度标准。

## Requirements

### Requirement: 暗色模式完整覆盖

应用 SHALL 在所有页面和组件中正确渲染暗色主题。暗色模式下文本和背景的对比度 SHALL 满足 WCAG AA 标准（正文 4.5:1，大文本 3:1）。主题切换 SHALL 即时生效无闪烁。

#### Scenario: 所有页面暗色渲染
- **WHEN** 用户在暗色模式下访问任意页面（Dashboard、Analytics、Users、Profile 等）
- **THEN** 所有文本在暗色背景下清晰可读
- **THEN** 图表（recharts）颜色适配暗色主题

#### Scenario: 组件主题一致
- **WHEN** 在暗色模式下使用模态框、下拉菜单、Toast 通知
- **THEN** 所有叠加层使用暗色背景
- **THEN** 阴影和边框适配暗色环境

### Requirement: 响应式布局

应用 SHALL 在桌面（>= 1024px）、平板（768-1023px）、移动端（< 768px）三个断点下正确渲染。

#### Scenario: 桌面端显示完整侧边栏
- **WHEN** 视口宽度 >= 1024px
- **THEN** 侧边栏完整展开（240px 宽），显示图标和文字
- **THEN** 主内容区正常显示

#### Scenario: 平板端侧边栏折叠
- **WHEN** 视口宽度在 768-1023px
- **THEN** 侧边栏折叠为图标模式（56px）
- **THEN** 悬停或点击展开完整菜单

#### Scenario: 移动端隐藏侧边栏
- **WHEN** 视口宽度 < 768px
- **THEN** 侧边栏替换为顶部汉堡菜单
- **THEN** 表格可横向滚动

### Requirement: 加载状态 (骨架屏)

应用 SHALL 在数据加载时显示骨架屏而非纯文字 "Loading..."。骨架屏 SHALL 匹配实际内容的形状（表格行、卡片、统计数字）。

#### Scenario: 表格加载状态
- **WHEN** 用户列表数据正在加载
- **THEN** 显示 5 行灰色脉冲占位行，宽度和列宽匹配

#### Scenario: 统计卡片加载状态
- **WHEN** Dashboard 的统计 API 正在加载
- **THEN** 显示 4 个灰色脉冲占位矩形

### Requirement: Toast 通知

非破坏性操作的结果 SHALL 通过 Toast 通知反馈。创建、更新、复制等操作成功 SHALL 显示绿色 Toast。操作失败 SHALL 显示红色 Toast 并包含错误信息。

#### Scenario: 保存成功 Toast
- **WHEN** 用户保存个人资料成功
- **THEN** 右下角弹出绿色 Toast："保存成功"
- **THEN** Toast 3 秒后自动消失

#### Scenario: 删除确认仍用对话框
- **WHEN** 用户点击删除按钮
- **THEN** 先弹出确认对话框
- **THEN** 确认后执行删除，成功则 Toast 反馈

### Requirement: 过渡动画

组件进入/退出的交互 SHALL 有 CSS transition 反馈。侧边栏展开/折叠、模态框打开/关闭、下拉菜单出现/消失 SHALL 有过渡效果。

#### Scenario: 模态框打开动画
- **WHEN** Issue 模态框打开
- **THEN** backdrop 淡入（opacity 0→1, 150ms ease）
- **THEN** 面板从右滑入（translateX 20px→0, 200ms ease）

### Requirement: 空状态

列表为空时 SHALL 显示图标 + 引导文案，而非纯文字 "No data"。

#### Scenario: 无 API Keys 时的提示
- **WHEN** 用户尚无 API Keys
- **THEN** 显示 Key 图标 + "还没有 API Key" + "创建第一个 API Key" 按钮

### Requirement: 无障碍性

所有交互元素 SHALL 支持键盘导航。Focus 状态 SHALL 有可见的 focus-visible 环。表单 SHALL 有正确的 label 关联。

#### Scenario: 键盘导航
- **WHEN** 用户使用 Tab 键在页面中导航
- **THEN** 每个可聚焦元素有清晰的蓝色 focus-visible 环
- **THEN** 焦点顺序符合视觉顺序

### Requirement: shared.css 归档

旧的 `packages/shared/styles/shared.css` SHALL 被标记为 DEPRECATED。在 admin 和 profile package 归档后（Phase 3），该文件 SHALL 不再被任何代码引用。

#### Scenario: shared.css 不可达
- **WHEN** 检查 monorepo 中所有代码的 import
- **THEN** 无代码引用 `shared.css`
