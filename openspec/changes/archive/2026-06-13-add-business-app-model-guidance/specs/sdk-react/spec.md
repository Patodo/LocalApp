## ADDED Requirements

### Requirement: usePermissions Hook

`@localapp/sdk-react` SHALL 导出 `usePermissions()` Hook，返回 `{ can, loading, error }`，用于基于当前用户、schema 业务元数据和记录内容判断 UI 操作是否可用。

#### Scenario: 判断当前用户可更新记录
- **WHEN** 组件调用 `const { can } = usePermissions()` 并执行 `can("update", record, schema)`
- **THEN** 返回值 SHALL 表示当前用户是否满足该 schema 对该记录的 update 策略

#### Scenario: 未加载当前用户时提供 loading
- **WHEN** `usePermissions()` 仍在加载当前用户或必要 schema 信息
- **THEN** `loading` SHALL 为 true，应用可据此延迟渲染受权限保护的操作

### Requirement: Can 组件

`@localapp/sdk-react` SHALL 导出 `<Can>` 组件，用于在 React UI 中根据权限判断有条件渲染子内容。

#### Scenario: 有权限时渲染内容
- **WHEN** `<Can action="update" record={record} schema={schema}>` 判断当前用户有权限
- **THEN** 组件 SHALL 渲染其 children

#### Scenario: 无权限时隐藏内容
- **WHEN** `<Can>` 判断当前用户无权限
- **THEN** 组件 SHALL 默认不渲染其 children

### Requirement: 权限 API 不作为安全边界

SDK 权限 API 文档 SHALL 明确说明 `can()` 和 `<Can>` 仅用于 UI 展示判断，后端 CRUD API 仍是记录级权限的安全边界。

#### Scenario: 文档说明安全边界
- **WHEN** 开发者阅读 `usePermissions` 或 `<Can>` 文档
- **THEN** 文档 SHALL 明确要求敏感数据权限必须由后端记录级访问控制执行
