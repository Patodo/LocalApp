## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the shared-design-system capability in LocalApp.

## Requirements

### Requirement: 共享 Design Token 定义

系统 SHALL 在 `packages/shared/styles/shared.css` 中定义统一的 CSS 自定义属性，作为所有平台内置页面的视觉基础。Token SHALL 包含以下类别：

- 颜色：`--bg`（页面底色）、`--surface`（卡片底色）、`--border`（边框色）、`--text`（主文字）、`--text-muted`（次级文字）、`--primary`（主操作色）、`--primary-hover`（hover 态）、`--danger`（危险色）、`--success`（成功色）、`--warning`（警告色）
- 间距与形状：`--radius`（8px）、`--radius-lg`（12px）
- 阴影：`--shadow-sm`、`--shadow`、`--shadow-lg`
- 字体：`--font-family`（系统字体栈，含 PingFang SC 和 Microsoft YaHei）
- 过渡：`--transition`（0.15s ease）

#### Scenario: Token 值符合设计基准
- **WHEN** 检查 `shared.css` 中的 `:root` 定义
- **THEN** `--bg` 为 `#f8f9fa`，`--surface` 为 `#ffffff`，`--primary` 为 `#2563eb`，`--font-family` 包含 PingFang SC

### Requirement: 通用组件样式

shared.css SHALL 定义以下通用组件 class：

- `.btn` / `.btn-primary` / `.btn-danger`：按钮基础 + 变体
- `.form-input` / `.form-label` / `.form-group`：表单元素
- `.card`：白色圆角卡片容器
- `.table` / `.table-header` / `.table-row`：数据表格
- `.badge` / `.badge-success` / `.badge-danger` / `.badge-warning`：状态标签（pill 形）
- `.page-container`：页面级容器（max-width + padding）

#### Scenario: 按钮样式符合设计基准
- **WHEN** 使用 `.btn-primary` class
- **THEN** 按钮背景色为 `var(--primary)`，圆角为 `var(--radius)`，hover 时背景色变为 `var(--primary-hover)`

#### Scenario: 卡片样式符合设计基准
- **WHEN** 使用 `.card` class
- **THEN** 元素背景为 `var(--surface)`，圆角为 `var(--radius-lg)`，边框为 `1px solid var(--border)`，阴影为 `var(--shadow)`

#### Scenario: 表格样式符合设计基准
- **WHEN** 使用 `.table` class
- **THEN** 表头使用大写字母、`12px` 字号，表体 `14px` 字号，行 hover 时背景为浅蓝色

### Requirement: CSS Reset

shared.css SHALL 在 token 和组件定义之前包含 minimal reset：`box-sizing: border-box`、`margin/padding: 0`、以及基础的 `html, body` 样式设置。

#### Scenario: 全局 box-sizing
- **WHEN** 页面引入 shared.css
- **THEN** 所有元素使用 `border-box` 盒模型
