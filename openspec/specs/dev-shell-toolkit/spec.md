# dev-shell-toolkit Specification

## Purpose

定义 LocalApp 本地开发模式中的 DevShell 工具集。该工具集帮助应用开发者在不接触生产环境的前提下切换模拟用户、固定业务时间、管理本地数据、查看业务规则和诊断信息。

## Requirements

### Requirement: DevShell 提供开发工具控制台

DevShell SHALL 在 `localapp dev` 模式下提供开发工具控制台，包含身份、时间、数据、业务规则和诊断分区。开发工具控制台 SHALL 通过最左侧 `DEV` 按钮的下拉菜单进入，而不是作为顶栏中的独立平铺按钮。该控制台 SHALL 只存在于开发模式，生产构建 SHALL NOT 包含控制台 UI、dev event 名称或 `/api/dev/*` 标识。

#### Scenario: dev 模式显示 DEV 下拉入口
- **WHEN** 用户执行 `localapp dev` 并打开应用
- **THEN** DevShell SHALL 在顶栏最左侧显示 `DEV` 按钮
- **AND** 点击 `DEV` SHALL 展开下拉菜单
- **AND** 下拉菜单 SHALL 包含开发工具入口
- **AND** 开发工具控制台 SHALL 能读取当前项目统一 Server 的 `/api/dev/context`

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

### Requirement: DevShell 支持切换模拟身份

DevShell SHALL 支持通过 `/api/dev/context` 在当前 Server 中真实存在的用户和未登录状态之间切换。模拟身份 SHALL 影响 `/api/me`、Named SQL 的 `currentUser`、`defaultFrom: "currentUser.id"` 和后端权限判断。上下文更新端点本身始终使用启动开发环境的真实 Server API Key，以便从未登录模拟状态切回。

#### Scenario: 切换预置用户
- **WHEN** 开发者在 DevShell 中选择预置用户 `alice`
- **THEN** DevShell SHALL 更新 `/api/dev/context`
- **AND** 后续 `/api/me` SHALL 返回 `alice`
- **AND** 后续 Named SQL、defaultFrom 和后端权限 SHALL 使用 `alice` 作为当前 visitor

#### Scenario: 切换未登录状态
- **WHEN** 开发者在 DevShell 中选择未登录状态
- **THEN** 后续 `/api/me` SHALL 返回未登录响应
- **AND** 需要当前用户的 `defaultFrom`、recordAccess 或 transition SHALL 按未登录 visitor 执行

#### Scenario: 拒绝不存在的用户
- **WHEN** 开发者尝试选择当前 Server 中不存在的用户 ID
- **THEN** `/api/dev/context` SHALL 返回 400
- **AND** SHALL NOT 创建临时用户或接受客户端提交的 role

### Requirement: DevShell 支持切换开发时间

DevShell SHALL 支持真实时间模式和固定 ISO 时间模式。固定时间 SHALL 影响统一 Server 应用 API 的 `/api/time` 和 Named SQL 系统变量 `now`。

#### Scenario: 设置固定 ISO 时间
- **WHEN** 开发者在 DevShell 中设置固定时间 `2026-07-01T09:00:00.000Z`
- **THEN** DevShell SHALL 更新 `/api/dev/context`
- **AND** 后续 Named SQL 中的 `now` SHALL 使用该固定时间

#### Scenario: 恢复真实时间
- **WHEN** 开发者在 DevShell 中切回真实时间模式
- **THEN** 统一 Server SHALL 使用当前系统时间解析 `now`
- **AND** 后续写入 SHALL 不再使用之前的固定时间

### Requirement: DevShell 在上下文变化后刷新应用数据

DevShell SHALL 在身份或时间上下文更新成功后派发 `localapp:dev-context-changed` 事件。SDK 数据 hooks SHOULD 监听该事件并刷新或失效已有查询；当自动刷新不可用时，DevShell SHALL 提供手动重载应用入口。

#### Scenario: 上下文变化刷新 SDK 数据
- **WHEN** DevShell 成功更新 `/api/dev/context`
- **THEN** DevShell SHALL 派发 `localapp:dev-context-changed`
- **AND** SDK 数据 hooks SHALL 重新读取受当前用户或时间影响的数据

#### Scenario: 提供手动重载兜底
- **WHEN** 应用没有使用支持该事件的 SDK hooks
- **THEN** DevShell SHALL 提供重载应用入口
- **AND** 开发者 SHALL 能通过重载观察新上下文下的应用状态

### Requirement: DevShell 提供本地数据工具

DevShell SHALL 提供应用数据 reset、snapshot 和 restore 工具。这些操作 SHALL 调用当前项目统一 Server 的应用数据维护服务，作用域只限当前 owner/application；Server 根目录 SHALL 位于项目 `tmp/localapp-dev/server/`。

#### Scenario: reset 本地数据
- **WHEN** 开发者在 DevShell 中执行 reset
- **THEN** 统一 Server SHALL 先创建安全备份
- **AND** SHALL 重建当前应用数据库并重新应用已安装版本的 migrations
- **AND** SHALL NOT 修改 CLI 的离线 schema 工作库

#### Scenario: 保存并恢复 snapshot
- **WHEN** 开发者保存 snapshot
- **THEN** 统一 Server SHALL 使用正式应用备份实现保存数据库和文件快照
- **AND** 当开发者恢复该 snapshot 时，后续 API 读取 SHALL 返回恢复后的数据

### Requirement: DevShell 展示业务规则和诊断信息

DevShell SHALL 展示当前 manifest 中的业务配置，包括 `recordAccess`、`defaultFields`、`transitions` 和 `enums`。DevShell SHALL 展示统一 Server 中当前模拟用户的最近请求诊断和 AI tool call 历史，帮助开发者理解本地行为。

#### Scenario: 展示业务规则
- **WHEN** DevShell 打开业务规则分区
- **THEN** DevShell SHALL 从 `/api/dev/business` 读取 manifest business 配置
- **AND** DevShell SHALL 展示 recordAccess、defaultFields、transitions 和 enums

#### Scenario: 展示最近请求诊断
- **WHEN** DevShell 打开诊断分区
- **THEN** DevShell SHALL 从 `/api/dev/diagnostics/requests` 展示最近请求的 method、path、status 和 duration
- **AND** SHALL NOT 返回其它 Server 用户的请求

#### Scenario: 展示 AI tool call 历史
- **WHEN** 应用通过 DevShell 注册或调用 AI 工具
- **THEN** DevShell SHALL 展示最近 AI tool call 历史
- **AND** 展示信息 SHALL 帮助开发者定位工具入参、结果和错误

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
