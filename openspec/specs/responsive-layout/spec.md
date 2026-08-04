# responsive-layout

## Purpose

[TBD] 定义响应式布局的断点规范和组件适配行为，确保应用在桌面、平板、移动端三种视口宽度下正确渲染。

## Requirements

### Requirement: 响应式断点

应用 SHALL 在桌面（>= 1024px）、平板（768-1023px）、移动端（< 768px）三个断点下正确渲染。侧边栏 SHALL 在平板端折叠为图标模式，在移动端替换为汉堡菜单。

#### Scenario: 桌面端显示完整侧边栏
- **WHEN** 视口宽度 >= 1024px
- **THEN** 侧边栏完整展开（240px 宽），显示图标和文字
- **THEN** 主内容区正常显示

#### Scenario: 平板端侧边栏折叠
- **WHEN** 视口宽度在 768-1023px
- **THEN** 侧边栏折叠为图标模式（56px）
- **THEN** 点击图标或悬停可展开完整菜单

#### Scenario: 移动端隐藏侧边栏
- **WHEN** 视口宽度 < 768px
- **THEN** 侧边栏替换为顶部汉堡菜单
- **THEN** 表格可横向滚动

### Requirement: 表格响应式

数据表格 SHALL 在小屏幕上支持横向滚动。表格的首列（通常为 ID 或名称）SHALL 可选 sticky 定位。

#### Scenario: 窄屏表格横向滚动
- **WHEN** 视口宽度 < 768px 且表格列数 > 3
- **THEN** 表格容器显示横向滚动条
- **THEN** 所有列可通过水平滚动访问

### Requirement: 卡片网格响应式

卡片网格 SHALL 根据视口宽度调整列数：4 列（桌面）、2 列（平板）、1 列（移动）。

#### Scenario: 统计卡片响应式
- **WHEN** Dashboard 页面在不同宽度渲染
- **THEN** >= 1024px 时显示 4 列
- **THEN** 768-1023px 时显示 2 列
- **THEN** < 768px 时显示 1 列
