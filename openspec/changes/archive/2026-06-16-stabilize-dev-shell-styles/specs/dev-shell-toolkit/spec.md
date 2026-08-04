## ADDED Requirements

### Requirement: DevShell 工具集样式稳定

DevShell 工具集 SHALL 在本地开发模式中具备稳定可见的样式。身份、时间、数据、业务规则、诊断、工具列表和 AI 面板 SHALL 使用 runtime preset 提供的语义 token 或 DevShell 专属 token，且 SHALL NOT 依赖用户项目是否生成 Tailwind 默认 palette。

#### Scenario: 工具集入口样式可见
- **WHEN** 用户执行 `localapp dev` 并打开应用
- **THEN** Dev Toolkit 入口按钮 SHALL 具有可见背景、文本色和 active 状态
- **AND** 这些样式 SHALL 来自 runtime preset 中声明的 token

#### Scenario: 工具面板样式可见
- **WHEN** 开发者打开 Dev Toolkit 面板
- **THEN** 面板背景、边框、标题、表单控件、危险操作按钮和诊断列表 SHALL 具有稳定可见样式
- **AND** computed style SHALL NOT 显示关键背景为 `rgba(0, 0, 0, 0)` 或关键文本回退为默认黑色

#### Scenario: AI 面板样式可见
- **WHEN** 开发者打开 DevShell AI 面板
- **THEN** AI 面板、消息气泡、输入框和发送按钮 SHALL 具有稳定可见样式
- **AND** 样式 SHALL 不依赖 `zinc`、`indigo`、`emerald` 等 Tailwind 默认 palette

#### Scenario: 用户项目 sync 后获得样式修复
- **WHEN** 现有用户项目执行新版 `localapp sync`
- **THEN** `.localapp/runtime/styles/preset.css` SHALL 被更新为包含 DevShell token 的版本
- **AND** `.localapp/runtime/dev-shell.tsx` SHALL 被更新为不使用裸 palette class 的版本
- **AND** 该项目重新运行 dev server 后 DevShell 工具集样式 SHALL 正常显示
