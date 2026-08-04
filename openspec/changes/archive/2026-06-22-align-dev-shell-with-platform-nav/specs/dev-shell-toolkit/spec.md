## MODIFIED Requirements

### Requirement: DevShell 提供开发工具控制台

DevShell SHALL 在 `localapp dev` 模式下提供开发工具控制台，包含身份、时间、数据、业务规则和诊断分区。开发工具控制台 SHALL 通过最左侧 `DEV` 按钮的下拉菜单进入，而不是作为顶栏中的独立平铺按钮。该控制台 SHALL 只存在于开发模式，生产构建 SHALL NOT 包含控制台 UI、dev event 名称或 `/api/dev/*` 标识。

#### Scenario: dev 模式显示 DEV 下拉入口
- **WHEN** 用户执行 `localapp dev` 并打开应用
- **THEN** DevShell SHALL 在顶栏最左侧显示 `DEV` 按钮
- **AND** 点击 `DEV` SHALL 展开下拉菜单
- **AND** 下拉菜单 SHALL 包含开发工具入口
- **AND** 开发工具控制台 SHALL 能读取本地 mini-server 的 `/api/dev/context`

#### Scenario: 工具列表入口位于 DEV 下拉
- **WHEN** 应用或系统注册了 AI 工具
- **THEN** `DEV` 下拉菜单 SHALL 显示工具列表入口和工具数量
- **AND** 点击该入口 SHALL 打开现有工具列表面板
- **AND** 顶栏 SHALL NOT 在 `DEV` 按钮之外平铺显示 `工具 N` 按钮

#### Scenario: 开发工具入口位于 DEV 下拉
- **WHEN** 用户打开 `DEV` 下拉菜单
- **THEN** 下拉菜单 SHALL 显示开发工具入口
- **AND** 点击该入口 SHALL 打开现有 Dev Toolkit 面板
- **AND** 顶栏 SHALL NOT 在 `DEV` 按钮之外平铺显示 `开发工具` 按钮

#### Scenario: 生产构建不包含开发工具标识
- **WHEN** 用户执行 `npm run build`
- **THEN** `dist/` 产物 SHALL NOT 包含 `DEV` 下拉菜单实现
- **AND** `dist/` 产物 SHALL NOT 包含 `Dev Toolkit`
- **AND** `dist/` 产物 SHALL NOT 包含 `localapp:dev-context-changed`
- **AND** `dist/` 产物 SHALL NOT 包含 `/api/dev/context`、`/api/dev/data`、`/api/dev/diagnostics` 或 `/api/dev/business`

## ADDED Requirements

### Requirement: DEV 下拉菜单交互

DevShell SHALL 为 `DEV` 按钮提供可访问的下拉菜单交互。菜单 SHALL 支持点击打开、再次点击关闭、点击菜单项后关闭，以及在打开其它侧栏时避免遮挡关键内容。

#### Scenario: 打开和关闭 DEV 下拉
- **WHEN** 用户点击 `DEV` 按钮
- **THEN** DevShell SHALL 展开下拉菜单
- **WHEN** 用户再次点击 `DEV` 按钮或选择菜单项
- **THEN** DevShell SHALL 收起下拉菜单

#### Scenario: DEV 下拉不遮挡已打开面板
- **WHEN** 用户从 `DEV` 下拉打开工具列表或开发工具面板
- **THEN** 下拉菜单 SHALL 自动关闭
- **AND** 对应面板 SHALL 正常显示

#### Scenario: 键盘可访问
- **WHEN** 用户使用键盘聚焦 `DEV` 按钮并按 Enter 或 Space
- **THEN** DevShell SHALL 切换下拉菜单展开状态
- **AND** focus-visible 样式 SHALL 清晰可见
