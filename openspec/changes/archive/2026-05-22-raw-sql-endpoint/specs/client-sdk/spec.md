## ADDED Requirements

### Requirement: LocalAppClient.exec 方法

`LocalAppClient` 接口 SHALL 新增 `exec(sql: string, params?: unknown[])` 方法，调用 `POST {basePath}/db/exec` 执行任意 SQL 语句。返回 `Promise<{ columns: string[]; rows: Record<string, unknown>[] } | { changes: number; lastInsertRowId: number }>`。

#### Scenario: 执行查询类 SQL

- **WHEN** 调用 `client.exec("SELECT * FROM todos WHERE status = ?", ["done"])`
- **THEN** 请求 `POST {basePath}/db/exec`，body 为 `{ sql: "SELECT * FROM todos WHERE status = ?", params: ["done"] }`，返回 `{ columns, rows }`

#### Scenario: 执行写入类 SQL

- **WHEN** 调用 `client.exec("INSERT INTO todos (title) VALUES (?)", ["New"])`
- **THEN** 请求 `POST {basePath}/db/exec`，返回 `{ changes: 1, lastInsertRowId: N }`

#### Scenario: 无参数执行

- **WHEN** 调用 `client.exec("SELECT * FROM todos")` 不传 params
- **THEN** body 中不含 params 字段（或 params 为空数组）

#### Scenario: raw SQL 端点不可用

- **WHEN** meta.db.mode 为 `crud` 时调用 `client.exec(...)`
- **THEN** 服务端返回 404，SDK throw Error

#### Scenario: 权限不足

- **WHEN** 非 owner 调用 `client.exec(...)` 且 sqlAccess 为 `owner`
- **THEN** 服务端返回 403，SDK throw Error

### Requirement: useExec Hook

SDK SHALL 提供 `useExec()` Hook，返回 `{ exec: (sql: string, params?: unknown[]) => Promise<ExecResult>, loading: boolean }`。`exec` 函数调用 `client.exec`，loading 在执行期间为 true。

#### Scenario: Hook 基本使用

- **WHEN** 组件调用 `const { exec, loading } = useExec()` 后执行 `exec("SELECT * FROM todos")`
- **THEN** 执行期间 `loading` 为 `true`，完成后 `loading` 为 `false`

#### Scenario: 执行错误

- **WHEN** SQL 语法错误时调用 `exec("INVALID SQL")`
- **THEN** Promise reject，`loading` 恢复为 `false`
