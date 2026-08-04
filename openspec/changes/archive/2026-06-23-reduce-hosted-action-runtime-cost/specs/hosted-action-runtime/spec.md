## ADDED Requirements

### Requirement: Action resource budgets
平台 SHALL 对每次 hosted backend action 调用实施资源预算，预算至少包含 RPC 次数、单次 SQL rows、累计 SQL rows、单次 SQL 结果 bytes、累计 SQL 结果 bytes、action 返回 bytes 和执行时间。

#### Scenario: action 超出 RPC 次数预算
- **WHEN** action handler 通过 ctx 发起的 RPC 次数超过平台配置的 `maxRpcCount`
- **THEN** 平台 MUST 终止该 action 调用
- **AND** 返回明确的 action resource budget 错误
- **AND** 错误码 MUST 表示 RPC 次数超限

#### Scenario: action SQL 返回过多 rows
- **WHEN** `ctx.query` 返回 rows 数量超过单次或累计 SQL rows 预算
- **THEN** 平台 MUST 拒绝继续执行该 action
- **AND** 返回明确的 SQL result too large 错误
- **AND** 错误消息 MUST 引导开发者使用分页、过滤、JOIN 或聚合查询

#### Scenario: action 返回体过大
- **WHEN** action handler 返回值序列化后的估算大小超过 `maxResultBytes`
- **THEN** 平台 MUST 拒绝返回该结果
- **AND** 返回明确的 action result too large 错误
- **AND** 响应 MUST NOT 暴露底层 structured clone 或 worker 内存异常作为主要错误文本

### Requirement: Platform-bounded action worker scheduling
平台 SHALL 使用平台级 worker 预算调度 hosted backend action，worker 数量 MUST NOT 由请求并发数或应用总数直接决定。

#### Scenario: 全局 worker 达到上限
- **WHEN** 当前活跃 action worker 数达到平台配置的全局上限
- **THEN** 新的 action 请求 MUST 进入有界队列或返回明确的 action queue 错误
- **AND** 平台 MUST NOT 为该请求立即创建超出全局上限的新 worker

#### Scenario: 同一应用 action 并发超过上限
- **WHEN** 同一 `{ownerId}/{appName}/{version}` 的 action 并发超过单应用上限
- **THEN** 超出部分 MUST 按 appKey 排队或返回明确的 action concurrency 错误
- **AND** 其他应用的 action 调度 MUST NOT 被该应用无限占用

#### Scenario: 队列等待超时
- **WHEN** action 请求等待 worker 或 appKey 队列超过平台配置的等待时间
- **THEN** 平台 MUST 返回明确的 action queue timeout 错误
- **AND** 不得执行该请求对应的 action handler

### Requirement: Recyclable hot action workers
平台 SHALL 在启用热 worker 复用时约束其版本、空闲时间、错误状态和全局 worker 预算。

#### Scenario: 复用同版本热 worker
- **WHEN** 同一 `{ownerId}/{appName}/{version}` 在 idle TTL 内再次调用 action
- **THEN** 平台 MUST 仅在 worker 绑定版本匹配且仍处于健康状态时复用已有 worker
- **AND** 该复用 MUST 仍遵守全局 worker 上限和单应用并发上限

#### Scenario: 应用版本变化
- **WHEN** 应用上传新版本或当前版本发生变化
- **THEN** 平台 MUST 不再使用旧版本绑定的热 worker 执行新请求
- **AND** 旧 worker MUST 被终止或等待 idle 回收

#### Scenario: worker 发生资源异常
- **WHEN** action worker 出现 timeout、resource limit、structured clone 失败或运行时异常退出
- **THEN** 平台 MUST 丢弃该 worker
- **AND** 后续 action MUST 使用新的健康 worker 或进入队列

### Requirement: Action runtime capacity diagnostics
平台 SHALL 为 hosted action runtime 记录容量相关诊断信息，用于解释排队、拒绝、超限和 worker 生命周期事件。

#### Scenario: action 完成时记录预算消耗
- **WHEN** action 调用成功或失败完成
- **THEN** 平台 MUST 记录 action 名称、应用标识、耗时、RPC 次数、SQL rows、SQL bytes、返回 bytes、队列等待时间和错误码

#### Scenario: action 因调度限制被拒绝
- **WHEN** action 请求因全局 worker 上限、appKey 队列或队列超时被拒绝
- **THEN** 平台 MUST 记录拒绝原因、应用标识、当前活跃 worker 数和队列等待信息
