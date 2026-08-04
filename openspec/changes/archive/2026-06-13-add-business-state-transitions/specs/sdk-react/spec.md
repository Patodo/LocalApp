## ADDED Requirements

### Requirement: useTransitions Hook

`@localapp/sdk-react` SHALL 导出 `useTransitions(resource, id, options?)` Hook，返回 `{ transitions, transition, loading, error, refresh }`。

#### Scenario: 加载可用 transitions
- **WHEN** 组件调用 `useTransitions("leave_requests", 1)`
- **THEN** Hook SHALL 请求该记录的 transitions 端点，并将结果放入 `transitions`

#### Scenario: id 为空时不请求
- **WHEN** 组件调用 `useTransitions("leave_requests", null)`
- **THEN** Hook SHALL 不发起网络请求，且 `transitions` 为空数组

### Requirement: useTransitions 执行 transition

`useTransitions` 返回的 `transition(name, payload?)` 方法 SHALL 调用 transition 执行端点，并返回更新后的记录。

#### Scenario: 执行 submit transition
- **WHEN** 应用调用 `transition("submit")`
- **THEN** SDK SHALL 发送 POST 请求到该记录的 `submit` transition 执行端点

#### Scenario: transition 成功后触发 onSuccess
- **WHEN** `useTransitions` 配置了 `onSuccess`
- **THEN** transition 执行成功后 SHALL 调用 `onSuccess(updatedRecord)`

### Requirement: transition 错误使用 LocalAppError

`useTransitions` SHALL 使用现有 `LocalAppError` 错误模型暴露 400、401、403、404 和网络错误。

#### Scenario: 当前状态不允许
- **WHEN** transition 执行端点返回 HTTP 400
- **THEN** Hook SHALL 将 `error` 设置为 `LocalAppError`，且 `error.status` 为 400
