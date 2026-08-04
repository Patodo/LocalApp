## MODIFIED Requirements

### Requirement: DevShell 视觉锚点对齐 nav-shell

DevShell 的顶部 nav 栏 SHALL 在底部添加一条 3px 高的彩色视觉锚点条，作为与 nav-shell 一致的视觉锚点。该视觉锚点 SHALL 使用 LocalApp runtime preset 明确定义的稳定 token，而不是直接依赖 Tailwind 默认 palette class（例如 `from-indigo-*`、`via-fuchsia-*`、`to-orange-*`）。其他元素（DEV 徽章、AI 按钮、tools 列表）SHALL 使用 runtime 提供的语义 token 或 DevShell 专属 token 保持稳定样式。

#### Scenario: DevShell 显示彩条
- **WHEN** dev 模式下 DevShell 渲染
- **THEN** nav 栏底部出现一条 3px 高的彩色视觉锚点条
- **AND** 视觉锚点条的颜色 SHALL 来自 runtime preset 中的 LocalApp token
- **AND** 视觉锚点条 SHALL NOT 依赖 `from-indigo-*`、`via-fuchsia-*` 或 `to-orange-*` 等 Tailwind 默认 palette class

#### Scenario: DevShell 不复刻 nav-shell 全部元素
- **WHEN** dev 模式下 DevShell 渲染
- **THEN** DevShell 不显示头像、登录按钮、收藏按钮、通知 bell、issues 按钮
- **AND** 这些功能属于平台身份层（nav-shell），不属于调试工具层（DevShell）

#### Scenario: DevShell 顶部样式不回退
- **WHEN** dev 模式下 DevShell 渲染
- **THEN** DEV 徽章 SHALL 具有非透明背景和非默认黑色文本
- **AND** tools、Dev Toolkit、AI 等顶部按钮 SHALL 具有可见背景、文本色和 hover/active 状态

## ADDED Requirements

### Requirement: DevShell 注入样式不得依赖未声明 palette

DevShell 注入相关源码 SHALL NOT 使用 runtime preset 未声明的 Tailwind 默认 palette class。所有 DevShell 颜色、边框、ring、渐变和状态色 SHALL 来自 shadcn 语义 token 或 `localapp-dev` 专属 token。

#### Scenario: 静态检查拒绝裸 palette
- **WHEN** 测试扫描 `init-repo/runtime/dev-shell.tsx`
- **THEN** 文件 SHALL NOT 包含 `bg-zinc-`、`text-zinc-`、`border-zinc-`、`bg-indigo-`、`text-indigo-`、`border-indigo-`、`bg-emerald-`、`text-emerald-`、`from-indigo-`、`via-fuchsia-` 或 `to-orange-`
- **AND** 文件中的 DevShell 专属颜色 class SHALL 使用 `localapp-dev` 前缀或已有语义 token
