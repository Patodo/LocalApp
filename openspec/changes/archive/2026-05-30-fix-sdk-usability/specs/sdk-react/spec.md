## MODIFIED Requirements

### Requirement: useList Hook

`useList<T>(resource, options?)` Hook SHALL 返回 `{ rows, pagination, loading, error, refresh }`。首次渲染时自动发起请求，`options` 变更时自动重新请求。`refresh()` 方法 SHALL 手动触发重新请求。Hook MUST 使用 `useMemo` 稳定化 options 的序列化值作为 effect 依赖，避免 `JSON.stringify(options)` 在每次渲染时创建新引用。

#### Scenario: 首次加载

- **WHEN** 组件首次渲染并调用 `useList("todos")`
- **THEN** `loading` 为 true，`rows` 为空数组
- **THEN** 请求完成后 `loading` 为 false，`rows` 包含返回数据

#### Scenario: 手动刷新

- **WHEN** 调用 `refresh()` 方法
- **THEN** 重新发起 GET 请求，`loading` 再次变为 true，数据更新

#### Scenario: options 引用稳定

- **WHEN** 父组件重新渲染但 `options` 对象值未变
- **THEN** `useList` 不发起新的网络请求（依赖通过 useMemo 稳定）

### Requirement: useCreate / useUpdate / useDelete Hooks

- `useCreate<T>(resource, options?)` SHALL 返回 `{ create }`。`create(data)` 方法 SHALL 发送 POST 请求并返回创建后的记录。当 `options.onSuccess` 被提供时，SHALL 在创建成功后调用 `onSuccess(createdRecord)`。
- `useUpdate<T>(resource, options?)` SHALL 返回 `{ update }`。`update(id, data)` 方法 SHALL 发送 PUT 请求并返回更新后的记录。当 `options.onSuccess` 被提供时，SHALL 在更新成功后调用 `onSuccess(updatedRecord)`。
- `useDelete(resource, options?)` SHALL 返回 `{ remove }`。`remove(id)` 方法 SHALL 发送 DELETE 请求。当 `options.onSuccess` 被提供时，SHALL 在删除成功后调用 `onSuccess()`。

三个方法 SHALL 通过 `useCallback` 稳定引用。`options` 参数 SHALL 为可选，不提供时行为与现有完全一致（向后兼容）。

#### Scenario: 创建记录后获取完整数据

- **WHEN** 调用 `create({ title: "New task" })`
- **THEN** 发送 POST 请求到 `${basePath}/todos`
- **THEN** 返回服务器创建的完整记录

#### Scenario: 创建记录后触发 onSuccess 回调

- **WHEN** 调用 `useCreate("todos", { onSuccess: (data) => { refresh(); } })` 然后调用 `create({ title: "test" })`
- **THEN** POST 成功后 `onSuccess` 被调用，参数为创建的完整记录

#### Scenario: 更新记录后触发 onSuccess 回调

- **WHEN** 调用 `useUpdate("todos", { onSuccess: () => { refresh(); } })` 然后调用 `update(1, { status: "done" })`
- **THEN** PUT 成功后 `onSuccess` 被调用

#### Scenario: 删除记录后触发 onSuccess 回调

- **WHEN** 调用 `useDelete("todos", { onSuccess: () => { refresh(); } })` 然后调用 `remove(1)`
- **THEN** DELETE 成功后 `onSuccess` 被调用（无参数）

#### Scenario: 不提供 options 时向后兼容

- **WHEN** 调用 `useCreate("todos")`（无 options 参数）
- **THEN** 行为与修改前完全一致，不触发任何回调
