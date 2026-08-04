## MODIFIED Requirements

### Requirement: DevShell 视觉锚点对齐 nav-shell

DevShell 的顶部 nav 栏 SHALL 在代码设计上派生自生产 nav-shell 的结构模型，而不是重新实现一套无约束的独立导航。DevShell SHALL 复用或显式映射生产 nav-shell 的区域划分、布局语义、应用信息区域、用户状态区域和基础样式 token。DevShell SHALL 在最左侧显示 `DEV` 按钮作为开发态唯一额外入口；`DEV` 按钮之后的区域 SHALL 按生产 nav-shell 的布局展示应用级信息区域和用户级操作区域。DevShell SHALL 继续在底部保留 3px 高的彩色视觉锚点条，且该视觉锚点 SHALL 使用 LocalApp runtime preset 明确定义的稳定 token，而不是直接依赖 Tailwind 默认 palette class。

#### Scenario: DevShell 顶栏显示 DEV 入口
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** nav 栏最左侧 SHALL 显示文本为 `DEV` 的按钮
- **AND** 该按钮 SHALL 具有可见背景、文本色、hover 状态和 focus-visible 状态
- **AND** nav 栏 SHALL NOT 显示独立的 `开发` 徽章

#### Scenario: DevShell 顶栏对齐生产 nav-shell
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** `DEV` 按钮之后 SHALL 显示与生产 nav-shell 对齐的应用外壳区域
- **AND** 顶栏 SHALL 展示应用名称或页面名称
- **AND** 顶栏右侧 SHALL 展示当前 dev context 用户状态或未登录状态
- **AND** dev-only 工具入口 SHALL NOT 平铺在生产 nav-shell 的应用名称和用户状态之间

#### Scenario: DevShell 顶栏派生自生产 nav-shell
- **WHEN** 检查 DevShell 顶栏实现
- **THEN** 实现 SHALL 通过共享结构、共享常量、共享子组件或显式映射函数派生自生产 nav-shell
- **AND** `DEV` SHALL 作为开发态扩展点注入到最左侧
- **AND** 实现 SHALL NOT 复制一份与生产 nav-shell 无依赖关系的完整导航结构

#### Scenario: DevShell 显示彩条
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** nav 栏底部出现一条 3px 高的彩色视觉锚点条
- **AND** 视觉锚点条的颜色 SHALL 来自 runtime preset 中的 LocalApp token
- **AND** 视觉锚点条 SHALL NOT 依赖 `from-indigo-*`、`via-fuchsia-*` 或 `to-orange-*` 等 Tailwind 默认 palette class

#### Scenario: DevShell 顶部样式不回退
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** `DEV` 按钮、下拉菜单、AI 按钮和用户状态区域 SHALL 具有可见背景、文本色和状态色
- **AND** computed style SHALL NOT 显示关键背景为 `rgba(0, 0, 0, 0)` 或关键文本回退为默认黑色

### Requirement: DevShell 不复制生产 nav-shell 用户入口

DevShell SHALL 对齐生产 nav-shell 的布局和平台信号，但 SHALL NOT 执行生产 nav-shell 的真实身份操作。DevShell SHALL 显示开发上下文中的当前用户或未登录状态；登录、登出、头像菜单、收藏、通知、Issue 等真实平台 Shell 功能 SHALL 继续只属于生产平台 Shell，除非本地开发后续显式引入对应模拟能力。

#### Scenario: 显示开发上下文身份而非真实登录入口
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** DevShell SHALL 显示当前 dev context 用户或未登录状态
- **AND** DevShell SHALL NOT 显示会触发生产登录、登出或头像菜单的真实入口

#### Scenario: 生产 nav-shell 功能仍归生产 shell
- **WHEN** 应用部署到生产 server 并由平台 Shell 承载
- **THEN** 用户入口、收藏、通知和 Issue 入口 SHALL 由生产 nav-shell 提供
- **AND** DevShell、`DEV` 按钮和开发工具下拉 SHALL NOT 出现在生产页面中

#### Scenario: 开发态外壳引导应用避免重复导航
- **WHEN** 开发者在 `localapp dev` 中查看应用
- **THEN** DevShell SHALL 让开发者能看到应用将被平台 nav-shell 承载的顶栏结构
- **AND** 应用不需要为了预览生产外壳而自行实现应用内导航栏
