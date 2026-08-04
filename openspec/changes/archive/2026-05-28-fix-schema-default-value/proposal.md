## Why

Server 端 CRUD API 在创建记录时，未应用 schema 字段的 `defaultValue` 约束。当应用代码不显式传某个字段时（如 `status`），数据库存储 `NULL` 而非 schema 定义的默认值（如 `"open"`）。这导致 Bug List 的 Status 列为空、筛选器无法按状态过滤等问题。Round 2 e2e 测试已确认此 bug。

## What Changes

- **修复 `insertRow`**: 在插入行时，若字段不在输入数据中且 schema 定义了 `defaultValue`，则使用默认值填充
- **修复 `alterTableAddColumn`**: 新增字段时，若定义了 `defaultValue`，应对存量行的该字段写入默认值

## Capabilities

### New Capabilities

- `schema-default-value`: Schema 字段的 `defaultValue` 约束在 CRUD 写入时正确生效

### Modified Capabilities

<!-- 不涉及现有 spec 的需求变更 -->

## Impact

- `packages/server/src/lib/crud-db.ts` — `insertRow` 和 `alterTableAddColumn` 函数
- 依赖 `FieldConstraints.defaultValue` 的应用行为会改变（从 `NULL` 变为默认值），属于 bug 修复，符合预期
