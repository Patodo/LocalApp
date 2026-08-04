## ADDED Requirements

### Requirement: client.action 方法
SDK SHALL 提供 `client.action<T = unknown>(name: string, input?: unknown): Promise<T>`，调用当前应用 basePath 下的 `/actions/:name`。

#### Scenario: native app 内调用 action
- **WHEN** 应用运行在 `/serve/alice/leave-form/`
- **AND** 调用 `client.action("leave.approve", { id: 1 })`
- **THEN** SDK MUST 请求 `POST /serve/alice/leave-form/api/actions/leave.approve`
- **AND** 请求体 MUST 为 `{ "input": { "id": 1 } }`

#### Scenario: action 返回业务数据
- **WHEN** server 返回 `{ success: true, data: { ok: true } }`
- **THEN** `client.action()` MUST resolve 为 `{ ok: true }`

#### Scenario: action 返回错误
- **WHEN** server 返回非 2xx 或 `{ success: false, error: "Access denied" }`
- **THEN** `client.action()` MUST 抛出 `LocalAppError`

### Requirement: useAction Hook
React SDK SHALL 提供 `useAction<TInput, TResult>(name)` Hook，返回 `{ run, loading, error }`，用于调用 backend action。

#### Scenario: 调用 action 时 loading
- **WHEN** `run(input)` 正在执行
- **THEN** `loading` MUST 为 `true`

#### Scenario: action 调用完成
- **WHEN** `run(input)` 成功或失败
- **THEN** `loading` MUST 归位为 `false`

#### Scenario: action 调用失败
- **WHEN** action endpoint 返回 403
- **THEN** `error` MUST 为 `LocalAppError` 且 `status === 403`
