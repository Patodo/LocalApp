## ADDED Requirements

### Requirement: Hosted action endpoint
系统 SHALL 提供 `POST /serve/:owner/:app/api/actions/:name`，用于执行当前应用版本中注册的 backend action。

#### Scenario: 执行已注册 action
- **WHEN** 前端调用已注册 action 并提交合法输入
- **THEN** server MUST 加载该应用当前版本的 action manifest
- **AND** 执行对应 action handler
- **AND** 返回 `{ success: true, data: ... }`

#### Scenario: 调用未注册 action
- **WHEN** 前端调用不存在的 action name
- **THEN** server MUST 返回 404
- **AND** 不得执行任何 action 代码

### Requirement: Action definition model
应用 SHALL 通过 `defineAction({ input, access, handler })` 声明 backend action，并由构建流程导出 action manifest。

#### Scenario: action 声明包含 handler
- **WHEN** action 文件导出 `defineAction` 结果
- **THEN** 构建流程 MUST 识别 action 名称、输入 schema、访问等级和 handler entry

#### Scenario: action 缺少 handler
- **WHEN** action 定义缺少可执行 handler
- **THEN** validate MUST 失败并指出 action 名称

### Requirement: Trusted action context
server SHALL 为 action handler 注入受信任 `ctx`，包含当前用户、应用 owner、服务器时间、named SQL 调用、事务、通知和日志能力。

#### Scenario: ctx.user 来自服务端身份
- **WHEN** 已登录用户调用 action
- **THEN** `ctx.user.id` MUST 来自服务端 session 或 API key 解析结果
- **AND** 前端不得通过 input 覆盖该身份

#### Scenario: ctx.query 复用 named SQL
- **WHEN** action handler 调用 `ctx.query("tasks.list", params)`
- **THEN** server MUST 使用当前应用 backend contract 中注册的 named query 执行
- **AND** 注入同一个 `currentUserId`、`ownerId` 和 `now`

#### Scenario: ctx.mutate 复用 named SQL
- **WHEN** action handler 调用 `ctx.mutate("tasks.close", params)`
- **THEN** server MUST 使用当前应用 backend contract 中注册的 named mutation 执行
- **AND** 应用不得直接提交 SQL 文本

### Requirement: Action access control
每个 action SHALL 声明访问等级，默认访问等级 SHALL 为 `authenticated`。server MUST 在执行 handler 前完成访问控制。

#### Scenario: 未登录用户调用 authenticated action
- **WHEN** 未登录用户调用 `access: "authenticated"` 的 action
- **THEN** server MUST 返回 401
- **AND** 不得执行 handler

#### Scenario: 非 owner 调用 owner action
- **WHEN** 已登录但不是应用 owner 的用户调用 `access: "owner"` 的 action
- **THEN** server MUST 返回 403
- **AND** 不得执行 handler

#### Scenario: ACL 用户调用 acl action
- **WHEN** action 声明 `access: "acl"` 且当前用户在 action ACL 中
- **THEN** server MUST 允许执行 handler

### Requirement: Action input validation
server SHALL 根据 action manifest 中的输入 schema 校验请求 input，并在 handler 执行前拒绝无效输入。

#### Scenario: 输入合法
- **WHEN** 请求 input 满足 action 输入 schema
- **THEN** handler MUST 收到校验后的 input

#### Scenario: 输入类型错误
- **WHEN** 请求 input 不满足 action 输入 schema
- **THEN** server MUST 返回 400
- **AND** 不得执行 handler

### Requirement: Runtime restrictions
action runtime SHALL 作为受平台托管函数执行环境，不得允许应用监听端口、注册 HTTP server、访问任意文件系统或直接连接任意数据库。

#### Scenario: action 尝试启动 HTTP server
- **WHEN** action bundle 尝试监听端口或注册长期运行的 server
- **THEN** runtime MUST 拒绝或终止执行

#### Scenario: action 只使用 ctx 能力
- **WHEN** action handler 仅使用 `ctx.query`、`ctx.mutate`、`ctx.transaction`、`ctx.notify` 和 `ctx.log`
- **THEN** runtime MUST 正常执行

### Requirement: Action transaction boundary
`ctx.transaction(fn)` SHALL 为同一应用数据库内的 named SQL 写入提供事务边界。

#### Scenario: 事务内 mutation 失败
- **WHEN** `ctx.transaction` 内多个 `ctx.mutate` 中任意一个失败
- **THEN** server MUST 回滚该事务中已执行的数据库写入

#### Scenario: 事务外副作用
- **WHEN** action 在事务中安排通知等外部副作用
- **THEN** server MUST 不承诺副作用随数据库事务自动回滚
- **AND** 文档 MUST 说明副作用应使用 after-commit 或事务完成后执行

### Requirement: Action observability and errors
server SHALL 为每次 action 调用记录 action 名称、调用者、状态码、耗时和错误摘要，并返回标准 API 错误格式。

#### Scenario: handler 抛出业务错误
- **WHEN** action handler 抛出可预期业务错误
- **THEN** server MUST 返回 `{ success: false, error: ... }`
- **AND** HTTP 状态码 MUST 表示错误类别

#### Scenario: handler 超时
- **WHEN** action handler 超过平台默认执行时间限制
- **THEN** server MUST 终止执行并返回 504 或 408 类错误
- **AND** 请求日志 MUST 标记为 timeout
