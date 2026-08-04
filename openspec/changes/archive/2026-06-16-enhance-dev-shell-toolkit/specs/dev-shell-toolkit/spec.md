## ADDED Requirements

### Requirement: DevShell 提供开发工具控制台
DevShell SHALL 在 `localapp dev` 注入的开发界面中提供开发工具控制台，用于管理本地开发上下文、数据状态和诊断信息。该控制台 SHALL 只在 dev 模式渲染，生产构建产物不得包含控制台代码、入口或文案。

#### Scenario: 开发模式显示工具控制台入口
- **WHEN** 用户通过 `localapp dev` 打开应用
- **THEN** DevShell 顶部 SHALL 显示开发工具入口
- **AND** 用户可以打开包含身份、时间、数据、业务规则和诊断分区的控制台

#### Scenario: 生产构建不包含开发工具控制台
- **WHEN** 用户执行 `npm run build`
- **THEN** 生成的 `dist/` 产物 SHALL 不包含开发工具控制台入口
- **AND** 产物中 SHALL 不包含 `/api/dev/context`、`localapp:dev-context-changed`、`Dev Toolkit` 等 dev-only 标识

### Requirement: DevShell 支持切换模拟身份
DevShell SHALL 允许开发者切换当前开发身份，包括预置用户、自定义用户和未登录状态。身份切换 SHALL 通过 mini-server 的 dev context API 持久到当前 dev 进程，并影响后续本地 API 请求。

#### Scenario: 切换到预置用户
- **WHEN** 开发者在 DevShell 中选择用户 `alice`
- **THEN** DevShell SHALL 调用 `/api/dev/context` 更新当前用户
- **AND** 后续 `/api/me` SHALL 返回 `alice`
- **AND** 后续 CRUD、`defaultFrom`、`recordAccess` 和 transitions SHALL 使用 `alice` 作为当前 visitor

#### Scenario: 切换到未登录状态
- **WHEN** 开发者在 DevShell 中选择未登录状态
- **THEN** DevShell SHALL 调用 `/api/dev/context` 将当前用户设为 `null`
- **AND** 需要当前用户的 `defaultFrom` 或 transition 写入 SHALL 返回未登录错误
- **AND** 受 `authenticated` 或用户字段策略保护的记录操作 SHALL 按未登录 visitor 校验

#### Scenario: 使用自定义用户
- **WHEN** 开发者输入自定义用户 id 和 name 并保存
- **THEN** DevShell SHALL 将该用户写入 dev context
- **AND** 本地 API SHALL 使用该 id/name 执行业务规则

### Requirement: DevShell 支持切换开发时间
DevShell SHALL 允许开发者在真实时间和固定时间之间切换。固定时间 SHALL 写入 mini-server dev context，并影响本地后端业务时间，例如 transition `set: "now"`。

#### Scenario: 设置固定开发时间
- **WHEN** 开发者在 DevShell 中设置固定 ISO 时间 `2026-07-01T09:00:00.000Z`
- **THEN** DevShell SHALL 调用 `/api/dev/context` 更新当前开发时间
- **AND** 后续由 mini-server 执行的 `now` 写入 SHALL 使用该固定时间

#### Scenario: 恢复真实时间
- **WHEN** 开发者在 DevShell 中选择恢复真实时间
- **THEN** DevShell SHALL 清除 dev context 中的固定时间
- **AND** 后续 mini-server 业务时间 SHALL 使用系统真实时间

### Requirement: DevShell 在上下文变化后刷新应用数据
DevShell SHALL 在身份或时间上下文变化成功后通知应用运行时刷新数据，避免界面继续展示旧用户或旧时间下的数据。

#### Scenario: 身份切换触发刷新事件
- **WHEN** DevShell 成功切换当前用户
- **THEN** DevShell SHALL 派发 `localapp:dev-context-changed` 事件
- **AND** SDK 数据 hooks SHOULD 通过现有 invalidate 机制刷新本地查询

#### Scenario: 应用未接入刷新事件
- **WHEN** 应用没有响应 `localapp:dev-context-changed` 事件
- **THEN** DevShell SHALL 提供手动重载应用的入口

### Requirement: DevShell 提供本地数据工具
DevShell SHALL 提供本地数据 reset、snapshot 和 restore 操作，这些操作 SHALL 仅作用于 `.localapp/dev.db` 和 `.localapp/dev-snapshots/`。

#### Scenario: 重置本地开发数据库
- **WHEN** 开发者在 DevShell 中确认 reset dev data
- **THEN** DevShell SHALL 调用 mini-server dev data API 删除并重建 `.localapp/dev.db`
- **AND** mini-server SHALL 重新应用 migrations 和 `db/seeds/dev.sql`
- **AND** 生产 server 和上传产物 SHALL 不受影响

#### Scenario: 保存并恢复快照
- **WHEN** 开发者保存当前 dev data snapshot
- **THEN** mini-server SHALL 将当前 `.localapp/dev.db` 复制到 `.localapp/dev-snapshots/`
- **WHEN** 开发者恢复该 snapshot
- **THEN** mini-server SHALL 用 snapshot 覆盖当前 `.localapp/dev.db`
- **AND** 后续 API 请求 SHALL 读取恢复后的数据

### Requirement: DevShell 展示业务规则和诊断信息
DevShell SHALL 展示当前 manifest business 配置、可用 transitions、最近请求和 AI tool call 历史，以帮助开发者解释应用在当前 dev context 下的行为。

#### Scenario: 查看业务规则
- **WHEN** 开发者打开业务规则分区
- **THEN** DevShell SHALL 展示 manifest 中每个业务表的 `recordAccess`、`defaultFields`、`transitions` 和 `enums`

#### Scenario: 查看请求诊断
- **WHEN** 应用向 mini-server 发起本地 API 请求
- **THEN** mini-server SHALL 记录最近请求的 method、path、status、duration 和截断后的 body 摘要
- **AND** DevShell SHALL 在诊断分区展示这些请求

#### Scenario: 查看 AI 工具调用历史
- **WHEN** AI 助手调用系统工具或应用注册工具
- **THEN** DevShell SHALL 展示工具名、参数、状态和结果摘要
