## ADDED Requirements

### Requirement: Worker-isolated action execution
平台 SHALL 在隔离 worker 中执行应用上传的 hosted backend action，并且 action 只能通过平台提供的 ctx 能力访问数据库、通知、日志和事务。

#### Scenario: 执行合法 action
- **WHEN** 前端调用已注册 hosted backend action 且输入满足 schema
- **THEN** 平台 MUST 在隔离 worker 中执行该 action
- **AND** action MUST 通过 `ctx.query`、`ctx.mutate`、`ctx.transaction`、`ctx.notify` 或 `ctx.log` 访问平台能力

#### Scenario: action 使用越界能力
- **WHEN** action bundle 尝试导入 Node 内置模块、监听端口、发起网络请求或直接访问数据库
- **THEN** 平台 MUST 拒绝执行并返回 hosted action boundary 错误

### Requirement: Action timeout and termination
平台 SHALL 对每次 hosted backend action 调用设置执行超时，并在超时后终止 worker。

#### Scenario: action 超过执行时间
- **WHEN** action handler 未能在平台配置的 timeout 内完成
- **THEN** 平台 MUST 终止对应 worker
- **AND** 返回 504 或等价的 action timeout 错误

### Requirement: Per-app action concurrency control
平台 SHALL 对同一 `{ownerId}/{appName}` 的 hosted backend action 调用实施并发背压，避免同一应用同时创建过多 worker。

#### Scenario: action 并发低于上限
- **WHEN** 同一应用的并发 action 调用数低于平台上限
- **THEN** 平台 MUST 正常调度这些 action

#### Scenario: action 并发超过上限
- **WHEN** 同一应用的并发 action 调用数超过平台上限
- **THEN** 平台 MUST 将超出部分排队或返回明确的 action concurrency 错误
- **AND** 平台 MUST NOT 为超出上限的请求立即创建无限数量 worker

### Requirement: Action RPC database backpressure
平台 SHALL 确保 action 内部通过 ctx 发起的数据库 RPC 遵守同一应用数据库的执行队列，不能绕过 named SQL 的数据库并发边界。

#### Scenario: action 内并发调用 ctx.query
- **WHEN** action handler 使用 `Promise.all` 同时调用多个 `ctx.query`
- **THEN** 平台 MUST 接收这些 RPC
- **AND** 每个数据库 RPC MUST 通过对应 app DB 的执行队列完成

### Requirement: Action resource and runtime error classification
平台 SHALL 将 worker、VM、structured clone、资源限制和 action handler 错误分类为可诊断的 hosted action 错误。

#### Scenario: worker 资源异常退出
- **WHEN** action worker 因资源限制、异常退出或 structured clone 失败而无法返回正常结果
- **THEN** 平台 MUST 返回明确的 action resource 或 action runtime 错误
- **AND** 响应错误文本 MUST NOT 只暴露底层 worker exit code 或未解释的底层异常

#### Scenario: action handler 抛出业务错误
- **WHEN** action handler 主动抛出普通错误
- **THEN** 平台 MUST 将该错误包装为 action runtime 错误
- **AND** 保留面向应用开发者可理解的错误消息

### Requirement: Database runtime errors during action RPC
平台 SHALL 将 action ctx SQL 执行过程中出现的 sql.js/WASM 底层错误归因为数据库运行时错误。

#### Scenario: action ctx query 触发 WASM 错误
- **WHEN** `ctx.query` 或 `ctx.mutate` 执行期间出现 `WebAssembly.RuntimeError` 或 `memory access out of bounds`
- **THEN** 平台 MUST 返回明确的 database runtime error
- **AND** 内部日志 MUST 记录原始错误摘要、action 名称和 SQL 名称

### Requirement: Action execution observability
平台 SHALL 为 hosted backend action 执行记录轻量诊断信息。

#### Scenario: action 成功完成
- **WHEN** hosted backend action 成功完成
- **THEN** 平台 MUST 记录 action 名称、应用标识、耗时、RPC 次数和数据库 RPC 摘要

#### Scenario: action 失败
- **WHEN** hosted backend action 失败
- **THEN** 平台 MUST 记录错误分类、action 名称、应用标识、worker 退出信息和已完成 RPC 摘要

### Requirement: Developer guidance for action scope
平台模板和开发者文档 SHALL 明确 hosted backend action 的推荐用途和限制。

#### Scenario: 开发者查看 init 模板说明
- **WHEN** 开发者阅读 init-repo 中的 backend action 说明
- **THEN** 文档 MUST 说明 action 适合写操作、级联删除、审批、同步计算和服务端校验
- **AND** 文档 MUST 说明无分页全量读模型应优先使用 named SQL 过滤、JOIN、聚合、分页或前端组装
